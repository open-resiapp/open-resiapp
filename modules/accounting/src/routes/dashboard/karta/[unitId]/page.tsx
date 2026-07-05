"use client";

// Karta bytu — unit ledger (BYT-20260512-002 Phase 1 slice 4). Excel-style
// running balance: Date | Description | Predpis | Úhrada | Zostatok, every
// row expandable to its per-service journal breakdown (drill-down to
// source). Balance is derived server-side from postings, never stored.

import { Fragment, useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";
import DownloadPredpisButton from "@modules/accounting/src/components/DownloadPredpisButton";
import DownloadVyuctovanieButton from "@modules/accounting/src/components/DownloadVyuctovanieButton";
import DownloadUpomienkaButton from "@modules/accounting/src/components/DownloadUpomienkaButton";

interface LedgerLine {
  categorySlug: string | null;
  accountCode: string;
  deltaCents: number;
}

interface LedgerRow {
  journalEntryId: string;
  postedAt: string;
  description: string;
  sourceType: string;
  deltaCents: number;
  balanceCents: number;
  lines: LedgerLine[];
}

interface Ledger {
  unitEntityId: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
  balanceCents: number;
  preplatokCents: number;
  rows: LedgerRow[];
}

interface OverdueItem {
  id: string;
  kind: "assessment" | "settlement";
  categorySlug: string;
  periodYear: number;
  month: number;
  openCents: number;
  dueDate: string;
  daysLate: number;
  ratePct: number;
  interestCents: number;
}

interface OverdueSummary {
  asOf: string;
  items: OverdueItem[];
  totalOpenCents: number;
  totalInterestCents: number;
}

export default function KartaDetailPage({ unitId }: { unitId: string }) {
  const t = useTranslations("Accounting.karta");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [overdue, setOverdue] = useState<OverdueSummary | null>(null);
  const [settlementYears, setSettlementYears] = useState<number[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/accounting/karta/${unitId}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(
        (data: {
          ledger: Ledger;
          canWrite: boolean;
          settlementYears?: number[];
        }) => {
          setLedger(data.ledger);
          setCanWrite(data.canWrite);
          setSettlementYears(data.settlementYears ?? []);
        }
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : "load")
      );
  }, [unitId]);

  useEffect(load, [load]);

  useEffect(() => {
    fetch(`/api/accounting/karta/${unitId}/overdue`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: OverdueSummary | null) => {
        if (data) setOverdue(data);
      })
      .catch(() => {});
  }, [unitId]);

  async function applyCredit() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/karta/${unitId}/apply-credit`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "apply");
    } finally {
      setApplying(false);
    }
  }

  if (error === "403") {
    return <p className="text-red-600 dark:text-red-400">{t("forbidden")}</p>;
  }
  if (error && !ledger) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!ledger) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const hasOpenDebt = ledger.balanceCents + ledger.preplatokCents > 0;

  return (
    <div className="max-w-4xl">
      <Link
        href="/accounting/karta"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToList")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("detailTitle", { unit: ledger.flatNumber ?? ledger.name })}
      </h1>
      <div className="flex items-center justify-between mb-6">
        <p className="text-gray-600 dark:text-gray-400">
          {ledger.vs ? t("vsLabel", { vs: ledger.vs }) : t("noVs")}
        </p>
        <span className="flex items-center gap-4">
          {settlementYears.map((y) => (
            <DownloadVyuctovanieButton key={y} unitId={unitId} year={y} />
          ))}
          <DownloadPredpisButton unitId={unitId} />
        </span>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("balance")}
          </p>
          <p
            className={`text-xl font-bold ${
              ledger.balanceCents > 0
                ? "text-red-600 dark:text-red-400"
                : ledger.balanceCents < 0
                  ? "text-green-700 dark:text-green-400"
                  : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {formatEur(ledger.balanceCents)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {ledger.balanceCents > 0
              ? t("balanceOwes")
              : ledger.balanceCents < 0
                ? t("balanceCredit")
                : t("balanceSettled")}
          </p>
        </div>
        {ledger.preplatokCents > 0 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("preplatok")}
            </p>
            <p className="text-xl font-bold text-green-700 dark:text-green-400">
              {formatEur(ledger.preplatokCents)}
            </p>
            {canWrite && hasOpenDebt && (
              <button
                onClick={applyCredit}
                disabled={applying}
                className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                {applying ? t("applyingCredit") : t("applyCredit")}
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm mb-4">
          {t("submitError")} ({error})
        </p>
      )}

      {/* Overdue + lawful interest (read-only calculator) */}
      {overdue && overdue.items.length > 0 && (
        <div className="mb-6 bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900 rounded-lg p-5 overflow-x-auto">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            {t("overdueTitle")}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t("overdueHint", { asOf: overdue.asOf })}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("overdueColItem")}</th>
                <th className="py-2 pr-4">{t("overdueColDue")}</th>
                <th className="py-2 pr-4 text-right">{t("overdueColDays")}</th>
                <th className="py-2 pr-4 text-right">{t("overdueColOpen")}</th>
                <th className="py-2 pr-4 text-right">{t("overdueColRate")}</th>
                <th className="py-2 text-right">{t("overdueColInterest")}</th>
              </tr>
            </thead>
            <tbody>
              {overdue.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {tCat(item.categorySlug as Parameters<typeof tCat>[0])}{" "}
                    {item.periodYear}-{String(item.month).padStart(2, "0")}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {format.dateTime(new Date(`${item.dueDate}T00:00:00Z`), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                    {item.daysLate}
                  </td>
                  <td className="py-2 pr-4 text-right text-red-600 dark:text-red-400">
                    {formatEur(item.openCents)}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-500 dark:text-gray-400">
                    {item.ratePct} %
                  </td>
                  <td className="py-2 text-right text-gray-900 dark:text-gray-100">
                    {formatEur(item.interestCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-gray-900 dark:text-gray-100">
                <td className="py-2 pr-4" colSpan={3}>
                  {t("overdueTotal")}
                </td>
                <td className="py-2 pr-4 text-right text-red-600 dark:text-red-400">
                  {formatEur(overdue.totalOpenCents)}
                </td>
                <td />
                <td className="py-2 text-right">
                  {formatEur(overdue.totalInterestCents)}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {t("overdueDisclaimer")}
            </p>
            {canWrite && <DownloadUpomienkaButton unitId={unitId} />}
          </div>
        </div>
      )}

      {/* Ledger table */}
      {ledger.rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colDate")}</th>
                <th className="py-2 pr-4">{t("colDescription")}</th>
                <th className="py-2 pr-4 text-right">{t("colPredpis")}</th>
                <th className="py-2 pr-4 text-right">{t("colUhrada")}</th>
                <th className="py-2 text-right">{t("colBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row) => (
                <Fragment key={row.journalEntryId}>
                  <tr
                    onClick={() =>
                      setExpanded((prev) =>
                        prev === row.journalEntryId
                          ? null
                          : row.journalEntryId
                      )
                    }
                    className="border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {format.dateTime(new Date(row.postedAt), {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                      {row.description}
                    </td>
                    {/* Columns key on the SOURCE, not the sign: charges
                        (predpis / opening / manual corrections) live in
                        the first column with their sign; everything
                        payment-sourced (payments, stornos, credit
                        applications) lives in the payment column, storno
                        shown negative. A manual credit must never read
                        as money the owner paid. */}
                    <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                      {row.sourceType !== "payment" && row.deltaCents !== 0
                        ? formatEur(row.deltaCents)
                        : ""}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                      {row.sourceType === "payment" && row.deltaCents !== 0
                        ? formatEur(-row.deltaCents)
                        : ""}
                    </td>
                    <td
                      className={`py-2 text-right font-medium ${
                        row.balanceCents > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {formatEur(row.balanceCents)}
                    </td>
                  </tr>
                  {expanded === row.journalEntryId && (
                    <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                      <td colSpan={5} className="py-2 px-6">
                        <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                          {row.lines.map((line, i) => (
                            <li key={i} className="flex justify-between">
                              <span>
                                {line.categorySlug
                                  ? tCat(
                                      line.categorySlug as Parameters<
                                        typeof tCat
                                      >[0]
                                    )
                                  : t("lineNoCategory")}
                              </span>
                              <span>{formatEur(line.deltaCents)}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

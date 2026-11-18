"use client";

// Pohľad účtovníka (BYT-20260512-002 Phase 8) — the ONLY screen with
// debit/credit terminology (spec UX guardrail). Trial balance over the
// chart of accounts + the append-only journal, read-only, for audit and
// accountant review.

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";
import ZavierkaPanel from "@modules/accounting/src/components/ZavierkaPanel";
import ExportButtons from "@modules/accounting/src/components/ExportButtons";

interface TrialBalanceYearRow {
  code: string;
  name: string;
  kind: string;
  openingCents: number;
  debitCents: number;
  creditCents: number;
  closingCents: number;
}

interface TrialBalanceYear {
  year: number;
  rows: TrialBalanceYearRow[];
  totals: {
    openingDebitCents: number;
    openingCreditCents: number;
    debitCents: number;
    creditCents: number;
    closingDebitCents: number;
    closingCreditCents: number;
  };
}

interface FpuoRow {
  unitEntityId: string;
  unitLabel: string;
  shareMissing: boolean;
  openingCents: number;
  predpisCents: number;
  paidCents: number;
  usesCents: number;
  incomeCents: number;
  otherCents: number;
  closingCents: number;
}

interface FpuoReport {
  year: number;
  rows: FpuoRow[];
  totals: Omit<FpuoRow, "unitEntityId" | "unitLabel" | "shareMissing">;
  unallocatedCents: number;
  ledgerClosingCents: number;
  differenceCents: number;
}

/** Dr − Cr balance shown as a signed amount with an MD/D marker. */
function SideAmount({ cents, dr, cr }: { cents: number; dr: string; cr: string }) {
  if (cents === 0) return <>{formatEur(0)}</>;
  return (
    <>
      {formatEur(Math.abs(cents))} <span className="text-ui-text-muted">{cents > 0 ? dr : cr}</span>
    </>
  );
}

interface JournalLine {
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  unitLabel: string | null;
  categorySlug: string | null;
}

interface JournalEntry {
  id: string;
  postedAt: string;
  description: string;
  sourceType: string;
  periodYear: number;
  lines: JournalLine[];
}

interface Payload {
  journal: { entries: JournalEntry[]; total: number };
  page: number;
  years: number[];
}

const PAGE_SIZE = 50;

export default function JournalPage() {
  const t = useTranslations("Accounting.journal");
  const format = useFormatter();

  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(0);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [tb, setTb] = useState<TrialBalanceYear | null>(null);
  const [fpuo, setFpuo] = useState<FpuoReport | null>(null);
  const [fpuoOpen, setFpuoOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    "valid" | "invalid" | "error" | null
  >(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  async function verifyBundle(file: File) {
    setVerifyResult(null);
    setVerifiedAt(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/accounting/export/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(res.status));
      setVerifyResult(body.valid ? "valid" : "invalid");
      if (body.valid && body.generatedAt) setVerifiedAt(body.generatedAt);
    } catch {
      setVerifyResult("error");
    }
  }

  const load = useCallback(() => {
    fetch(`/api/accounting/journal?page=${page}&tb=0`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((payload: Payload) => setData(payload))
      .catch(() => setError(true));
  }, [page]);

  useEffect(load, [load]);

  // Trial balance for the chosen accounting year (opening / turnover /
  // closing). Fetched per year change only — not on journal paging.
  useEffect(() => {
    setTb(null);
    fetch(`/api/accounting/reports/trial-balance?format=json&year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((payload: TrialBalanceYear) => setTb(payload))
      .catch(() => setError(true));
  }, [year]);

  // FPÚO per unit — only once the section is opened (heavier query).
  useEffect(() => {
    if (!fpuoOpen) return;
    setFpuo(null);
    fetch(`/api/accounting/reports/fpuo?format=json&year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((payload: FpuoReport) => setFpuo(payload))
      .catch(() => setError(true));
  }, [fpuoOpen, year]);

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!data) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const pages = Math.max(1, Math.ceil(data.journal.total / PAGE_SIZE));

  return (
    <div className="max-w-5xl">
      <Link
        href="/accounting"
        className="inline-flex min-h-11 items-center text-base text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        <a
          href="/api/accounting/export"
          download
          className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg text-base"
        >
          {t("exportButton")}
        </a>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-4">{t("subtitle")}</p>

      {/* Účtovná závierka approval (AC 423/521) */}
      <ZavierkaPanel />

      {/* Bundle verification */}
      <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-base">
        <p className="text-gray-700 dark:text-gray-300 mb-2">
          {t("verifyHint")}
        </p>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) verifyBundle(file);
            e.target.value = "";
          }}
          className="text-base text-gray-700 dark:text-gray-300"
        />
        {verifyResult === "valid" && (
          <p className="mt-2 text-green-700 dark:text-green-400">
            ✅ {t("verifyValid", { generatedAt: verifiedAt ?? "" })}
          </p>
        )}
        {verifyResult === "invalid" && (
          <p className="mt-2 text-red-600 dark:text-red-400 font-medium">
            ❌ {t("verifyInvalid")}
          </p>
        )}
        {verifyResult === "error" && (
          <p className="mt-2 text-red-600 dark:text-red-400">
            {t("verifyError")}
          </p>
        )}
      </div>

      {/* Year selector — drives the trial balance and the FPÚO report. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-base text-gray-700 dark:text-gray-300">
          {t("yearLabel")}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          >
            {[...new Set([year, ...data.years])]
              .sort((a, b) => b - a)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        </label>
      </div>

      {/* Trial balance (obratová predvaha) for the year */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("trialBalanceYearTitle", { year })}
          </h2>
          <ExportButtons report="trial-balance" params={{ year }} />
        </div>
        <p className="mb-3 text-base text-gray-600 dark:text-gray-400">
          {t("trialBalanceYearHint")}
        </p>
        {!tb ? (
          <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        ) : tb.rows.every(
            (r) => r.openingCents === 0 && r.debitCents === 0 && r.creditCents === 0
          ) ? (
          <p className="text-base text-gray-600 dark:text-gray-400">{t("empty")}</p>
        ) : (
          <>
            {(() => {
              const active = tb.rows.filter(
                (r) => r.openingCents !== 0 || r.debitCents !== 0 || r.creditCents !== 0
              );
              return (
                <>
                  {/* < sm: one card per account (390 px, no sideways scroll) */}
                  <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                    {active.map((row) => (
                      <li key={row.code} className="py-3 text-base">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">
                          <span className="font-mono">{row.code}</span> {row.name}
                        </p>
                        <dl className="mt-1 grid grid-cols-2 gap-x-3 text-gray-700 dark:text-gray-300">
                          <dt>{t("colOpening")}</dt>
                          <dd className="text-right">
                            <SideAmount cents={row.openingCents} dr={t("sideDr")} cr={t("sideCr")} />
                          </dd>
                          <dt>{t("colTurnoverDr")}</dt>
                          <dd className="text-right">{formatEur(row.debitCents)}</dd>
                          <dt>{t("colTurnoverCr")}</dt>
                          <dd className="text-right">{formatEur(row.creditCents)}</dd>
                          <dt className="font-semibold">{t("colClosing")}</dt>
                          <dd className="text-right font-semibold">
                            <SideAmount cents={row.closingCents} dr={t("sideDr")} cr={t("sideCr")} />
                          </dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          <th className="py-2 pr-4">{t("colAccount")}</th>
                          <th className="py-2 pr-4">{t("colName")}</th>
                          <th className="py-2 pr-4 text-right">{t("colOpening")}</th>
                          <th className="py-2 pr-4 text-right">{t("colTurnoverDr")}</th>
                          <th className="py-2 pr-4 text-right">{t("colTurnoverCr")}</th>
                          <th className="py-2 text-right">{t("colClosing")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.map((row) => (
                          <tr key={row.code} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-2 pr-4 font-mono text-gray-900 dark:text-gray-100">{row.code}</td>
                            <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{row.name}</td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                              <SideAmount cents={row.openingCents} dr={t("sideDr")} cr={t("sideCr")} />
                            </td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                              {formatEur(row.debitCents)}
                            </td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                              {formatEur(row.creditCents)}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                              <SideAmount cents={row.closingCents} dr={t("sideDr")} cr={t("sideCr")} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Totals — Σ MD must equal Σ D in every column pair. */}
                  <dl className="mt-3 grid grid-cols-1 gap-1 text-base font-semibold text-gray-900 dark:text-gray-100 sm:grid-cols-3">
                    <div>
                      <dt className="font-normal text-gray-600 dark:text-gray-400">{t("totalsOpening")}</dt>
                      <dd>
                        {formatEur(tb.totals.openingDebitCents)} {t("sideDr")} / {formatEur(tb.totals.openingCreditCents)} {t("sideCr")}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-normal text-gray-600 dark:text-gray-400">{t("totalsTurnover")}</dt>
                      <dd>
                        {formatEur(tb.totals.debitCents)} {t("sideDr")} / {formatEur(tb.totals.creditCents)} {t("sideCr")}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-normal text-gray-600 dark:text-gray-400">{t("totalsClosing")}</dt>
                      <dd>
                        {formatEur(tb.totals.closingDebitCents)} {t("sideDr")} / {formatEur(tb.totals.closingCreditCents)} {t("sideCr")}
                      </dd>
                    </div>
                  </dl>
                  {(tb.totals.debitCents !== tb.totals.creditCents ||
                    tb.totals.closingDebitCents !== tb.totals.closingCreditCents) && (
                    <p role="alert" className="mt-2 text-base font-medium text-red-700 dark:text-red-400">
                      {t("totalsUnbalanced")}
                    </p>
                  )}
                </>
              );
            })()}
          </>
        )}
      </section>

      {/* FPÚO per unit (§ 10 zák. 182/1993) */}
      <details
        className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6"
        onToggle={(e) => setFpuoOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("fpuoTitle", { year })}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-base text-gray-600 dark:text-gray-400">{t("fpuoHint")}</p>
          <ExportButtons report="fpuo" params={{ year }} />
          {!fpuo ? (
            <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ) : (
            <>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...fpuo.rows, null].map((row) => {
                  const r = row ?? { ...fpuo.totals, unitLabel: t("totals"), shareMissing: false, unitEntityId: "total" };
                  return (
                    <li key={r.unitEntityId} className={`py-3 text-base ${row ? "" : "font-semibold"}`}>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">
                        {r.unitLabel}
                        {r.shareMissing && (
                          <span className="ml-2 font-normal text-amber-700 dark:text-amber-400">
                            {t("fpuoShareMissing")}
                          </span>
                        )}
                      </p>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-gray-700 dark:text-gray-300 sm:grid-cols-4 lg:grid-cols-7">
                        {(
                          [
                            ["fpuoColOpening", r.openingCents],
                            ["fpuoColPredpis", r.predpisCents],
                            ["fpuoColPaid", r.paidCents],
                            ["fpuoColUses", r.usesCents],
                            ["fpuoColIncome", r.incomeCents],
                            ["fpuoColOther", r.otherCents],
                            ["fpuoColClosing", r.closingCents],
                          ] as const
                        ).map(([key, cents]) => (
                          <div key={key} className="flex justify-between gap-2 sm:block">
                            <dt className="text-gray-600 dark:text-gray-400">{t(key)}</dt>
                            <dd className="sm:text-left">{formatEur(cents)}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  );
                })}
              </ul>
              <p
                className={`text-base ${
                  fpuo.differenceCents === 0
                    ? "text-green-700 dark:text-green-400"
                    : "font-medium text-red-700 dark:text-red-400"
                }`}
              >
                {fpuo.differenceCents === 0
                  ? t("fpuoReconciled", { amount: formatEur(fpuo.ledgerClosingCents) })
                  : t("fpuoDifference", {
                      ledger: formatEur(fpuo.ledgerClosingCents),
                      difference: formatEur(fpuo.differenceCents),
                    })}
              </p>
              {fpuo.unallocatedCents !== 0 && (
                <p className="text-base text-amber-700 dark:text-amber-400">
                  {t("fpuoUnallocated", { amount: formatEur(fpuo.unallocatedCents) })}
                </p>
              )}
            </>
          )}
        </div>
      </details>

      {/* Journal */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("journalTitle", { total: data.journal.total })}
          </h2>
          {pages > 1 && (
            <span className="flex items-center gap-2 text-base">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="min-h-11 min-w-11 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
              >
                ←
              </button>
              <span className="text-gray-600 dark:text-gray-400">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="min-h-11 min-w-11 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
              >
                →
              </button>
            </span>
          )}
        </div>
        <ul className="space-y-1">
          {data.journal.entries.map((entry) => (
            <li key={entry.id}>
              <button
                onClick={() =>
                  setExpanded((prev) => (prev === entry.id ? null : entry.id))
                }
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left text-base flex-wrap"
              >
                <span className="text-gray-900 dark:text-gray-100">
                  {format.dateTime(new Date(entry.postedAt), {
                    dateStyle: "medium",
                  })}{" "}
                  — {entry.description}
                </span>
                <span className="text-base text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {entry.periodYear} · {t.has(`sourceType.${entry.sourceType}`) ? t(`sourceType.${entry.sourceType}`) : entry.sourceType}
                </span>
              </button>
              {expanded === entry.id && (
                <div className="overflow-x-auto">
                <table className="w-full text-base bg-gray-50 dark:bg-gray-800/30 rounded mb-1">
                  <tbody>
                    {entry.lines.map((line, i) => (
                      <tr key={i}>
                        <td className="py-1 px-3 font-mono text-gray-900 dark:text-gray-100 w-24">
                          {line.accountCode}
                        </td>
                        <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">
                          {line.accountName}
                          {line.unitLabel ? ` · ${line.unitLabel}` : ""}
                        </td>
                        <td className="py-1 pr-3 text-right text-gray-900 dark:text-gray-100 w-28">
                          {line.debitCents > 0
                            ? formatEur(line.debitCents)
                            : ""}
                        </td>
                        <td className="py-1 pr-3 text-right text-gray-900 dark:text-gray-100 w-28">
                          {line.creditCents > 0
                            ? formatEur(line.creditCents)
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

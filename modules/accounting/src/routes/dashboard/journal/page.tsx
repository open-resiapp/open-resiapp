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

interface TrialBalanceRow {
  code: string;
  name: string;
  kind: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
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
  trialBalance: TrialBalanceRow[];
  journal: { entries: JournalEntry[]; total: number };
  page: number;
}

const PAGE_SIZE = 50;

export default function JournalPage() {
  const t = useTranslations("Accounting.journal");
  const format = useFormatter();

  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(0);
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
    fetch(`/api/accounting/journal?page=${page}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((payload: Payload) => setData(payload))
      .catch(() => setError(true));
  }, [page]);

  useEffect(load, [load]);

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!data) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const pages = Math.max(1, Math.ceil(data.journal.total / PAGE_SIZE));
  const activeAccounts = data.trialBalance.filter(
    (r) => r.debitCents !== 0 || r.creditCents !== 0
  );

  return (
    <div className="max-w-5xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        <a
          href="/api/accounting/export"
          download
          className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg text-sm"
        >
          {t("exportButton")}
        </a>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-4">{t("subtitle")}</p>

      {/* Účtovná závierka approval (AC 423/521) */}
      <ZavierkaPanel />

      {/* Bundle verification */}
      <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-sm">
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
          className="text-sm text-gray-700 dark:text-gray-300"
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

      {/* Trial balance */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6 overflow-x-auto">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          {t("trialBalanceTitle")}
        </h2>
        {activeAccounts.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colAccount")}</th>
                <th className="py-2 pr-4">{t("colName")}</th>
                <th className="py-2 pr-4 text-right">{t("colDebit")}</th>
                <th className="py-2 pr-4 text-right">{t("colCredit")}</th>
                <th className="py-2 text-right">{t("colBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map((row) => (
                <tr
                  key={row.code}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 pr-4 font-mono text-gray-900 dark:text-gray-100">
                    {row.code}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {row.name}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-500 dark:text-gray-400">
                    {formatEur(row.debitCents)}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-500 dark:text-gray-400">
                    {formatEur(row.creditCents)}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                    {formatEur(row.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-gray-900 dark:text-gray-100">
                <td className="py-2 pr-4" colSpan={2}>
                  {t("totals")}
                </td>
                <td className="py-2 pr-4 text-right">
                  {formatEur(
                    activeAccounts.reduce((s, r) => s + r.debitCents, 0)
                  )}
                </td>
                <td className="py-2 pr-4 text-right">
                  {formatEur(
                    activeAccounts.reduce((s, r) => s + r.creditCents, 0)
                  )}
                </td>
                <td className="py-2 text-right">
                  {formatEur(
                    activeAccounts.reduce((s, r) => s + r.balanceCents, 0)
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Journal */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("journalTitle", { total: data.journal.total })}
          </h2>
          {pages > 1 && (
            <span className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
              >
                ←
              </button>
              <span className="text-gray-600 dark:text-gray-400">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
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
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left text-sm"
              >
                <span className="text-gray-900 dark:text-gray-100">
                  {format.dateTime(new Date(entry.postedAt), {
                    dateStyle: "medium",
                  })}{" "}
                  — {entry.description}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {entry.periodYear} · {entry.sourceType}
                </span>
              </button>
              {expanded === entry.id && (
                <table className="w-full text-xs bg-gray-50 dark:bg-gray-800/30 rounded mb-1">
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
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

"use client";

// Bank import + reconciliation (BYT-20260512-002 Phase 2). Xero-style
// two-part flow: upload a CAMT.053 statement (auto-matches by VS, known
// IBAN), then work through the lines that need review — each shows the
// engine's best suggestion with a confidence badge; accept in one click
// ("Sedí") or pick a different unit. Fuzzy name hits are suggestion-only
// by design (domain edge case 9).

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface Suggestion {
  unitEntityId: string | null;
  unitLabel: string | null;
  confidence: number;
  rule: string;
  autoApply: boolean;
}

interface Line {
  paymentId: string;
  receivedAt: string;
  amountCents: number;
  vs: string | null;
  counterpartyIban: string | null;
  counterpartyName: string | null;
  narrative: string | null;
  suggestion: Suggestion;
}

interface UnitOption {
  id: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
}

interface ImportSummary {
  credits: number;
  imported: number;
  skippedDuplicates: number;
  autoMatched: number;
  needsReview: number;
  debitsSkipped: number;
}

interface FioState {
  connected: boolean;
  tokenPreview: string | null;
  lastSyncAt: string | null;
}

export default function ReconciliationPage() {
  const t = useTranslations("Accounting.reconciliation");
  const format = useFormatter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[] | null>(null);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [fio, setFio] = useState<FioState | null>(null);
  const [fioToken, setFioToken] = useState("");
  const [fioSaving, setFioSaving] = useState(false);
  const [fioSyncing, setFioSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/accounting/reconciliation")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { lines: Line[]; units: UnitOption[] }) => {
        setLines(data.lines);
        setUnits(data.units);
      })
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    fetch("/api/accounting/fio")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FioState | null) => {
        if (data) setFio(data);
      })
      .catch(() => {});
  }, []);

  async function saveFioToken() {
    if (!fioToken.trim()) return;
    setFioSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/fio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: fioToken.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setFioToken("");
      const state = await fetch("/api/accounting/fio").then((r) => r.json());
      setFio(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fio");
    } finally {
      setFioSaving(false);
    }
  }

  async function syncFioNow() {
    setFioSyncing(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/accounting/fio/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSummary(body);
      const state = await fetch("/api/accounting/fio").then((r) => r.json());
      setFio(state);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "fio");
    } finally {
      setFioSyncing(false);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const xml = await file.text();
      const res = await fetch("/api/accounting/bank-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSummary(body);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirm(line: Line) {
    const unitEntityId =
      overrides[line.paymentId] ?? line.suggestion.unitEntityId;
    if (!unitEntityId) return;
    setConfirming(line.paymentId);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounting/reconciliation/${line.paymentId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitEntityId }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "confirm");
    } finally {
      setConfirming(null);
    }
  }

  if (error === "load") {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!lines) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const selectClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm";

  return (
    <div className="max-w-4xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {/* Upload */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {t("uploadTitle")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {t("uploadHint")}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".xml,text/xml,application/xml"
          disabled={importing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file);
          }}
          className="text-sm text-gray-700 dark:text-gray-300"
        />
        {importing && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t("importing")}
          </p>
        )}
        {summary && (
          <div className="mt-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 text-sm text-green-900 dark:text-green-200">
            <p>
              {t("summary", {
                imported: summary.imported,
                autoMatched: summary.autoMatched,
                needsReview: summary.needsReview,
              })}
            </p>
            {(summary.skippedDuplicates > 0 || summary.debitsSkipped > 0) && (
              <p className="mt-1">
                {t("summarySkipped", {
                  duplicates: summary.skippedDuplicates,
                  debits: summary.debitsSkipped,
                })}
              </p>
            )}
          </div>
        )}
        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("submitError")} ({error})
          </p>
        )}

        {/* Fio live connection */}
        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            {t("fioTitle")}
          </h3>
          {fio?.connected ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {t("fioConnected", { preview: fio.tokenPreview ?? "" })}
                {fio.lastSyncAt &&
                  ` · ${t("fioLastSync", {
                    date: format.dateTime(new Date(fio.lastSyncAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}`}
              </span>
              <button
                onClick={syncFioNow}
                disabled={fioSyncing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm"
              >
                {fioSyncing ? t("fioSyncing") : t("fioSync")}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="w-full text-sm text-gray-600 dark:text-gray-400">
                {t("fioHint")}
              </p>
              <input
                value={fioToken}
                onChange={(e) => setFioToken(e.target.value)}
                placeholder={t("fioTokenPlaceholder")}
                className="flex-1 min-w-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-mono"
              />
              <button
                onClick={saveFioToken}
                disabled={fioSaving || !fioToken.trim()}
                className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg disabled:opacity-50 text-sm"
              >
                {fioSaving ? t("fioSaving") : t("fioConnect")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Unmatched lines */}
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {t("unmatchedTitle", { count: lines.length })}
      </h2>
      {lines.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("allMatched")}</p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => {
            const selected =
              overrides[line.paymentId] ??
              line.suggestion.unitEntityId ??
              "";
            return (
              <li
                key={line.paymentId}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {formatEur(line.amountCents)}
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-3">
                        {format.dateTime(new Date(line.receivedAt), {
                          dateStyle: "medium",
                        })}
                      </span>
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {line.counterpartyName ?? "—"}
                      {line.vs && (
                        <span className="ml-2">
                          {t("vsLabel", { vs: line.vs })}
                        </span>
                      )}
                    </p>
                    {line.narrative && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                        {line.narrative}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {line.suggestion.unitEntityId && (
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          line.suggestion.confidence >= 80
                            ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                            : "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
                        }`}
                      >
                        {t("confidence", {
                          value: line.suggestion.confidence,
                        })}
                      </span>
                    )}
                    <select
                      value={selected}
                      onChange={(e) =>
                        setOverrides((prev) => ({
                          ...prev,
                          [line.paymentId]: e.target.value,
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="">{t("pickUnit")}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.flatNumber ?? u.name}
                          {u.vs ? ` (${t("vsLabel", { vs: u.vs })})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => confirm(line)}
                      disabled={confirming === line.paymentId || !selected}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm"
                    >
                      {confirming === line.paymentId
                        ? t("confirming")
                        : t("confirm")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

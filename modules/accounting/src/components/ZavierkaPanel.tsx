"use client";

// Účtovná závierka approval panel (AC 423/521). Shows the approval state for
// a chosen year and — for the CHAIRMAN only — an approve action gated on a
// recorded, closed zhromaždenie vote. Approval records the decision; it never
// posts to the ledger (separation of duties).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Status {
  year: number;
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  approved: boolean;
  approvedAt: string | null;
  votingItemId: string | null;
  canApprove: boolean;
  viewerCanApprove: boolean;
}

export default function ZavierkaPanel() {
  const t = useTranslations("Accounting.zavierka");
  const [year, setYear] = useState(() => new Date().getUTCFullYear() - 1);
  const [status, setStatus] = useState<Status | null>(null);
  const [votingItemId, setVotingItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [approveFailed, setApproveFailed] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    // A non-OK response (403/500) or a network error must NOT collapse into
    // the "publish settlement first" state — surface a distinct load error.
    fetch(`/api/accounting/zavierka?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: Status) => setStatus(data))
      .catch(() => {
        setStatus(null);
        setLoadFailed(true);
      });
  }, [year]);

  useEffect(load, [load]);

  async function approve() {
    if (!votingItemId.trim()) return;
    setBusy(true);
    setApproveFailed(false);
    try {
      const res = await fetch("/api/accounting/zavierka", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, votingItemId: votingItemId.trim() }),
      });
      if (!res.ok) throw new Error();
      setVotingItemId("");
      load();
    } catch {
      // Backend messages are EN-only technical strings (module-wide known
      // debt — the domain-error i18n catalog is a separate spec); show a
      // translated generic failure rather than leaking them raw.
      setApproveFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm";

  return (
    <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-sm">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t("title")}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-3">{t("hint")}</p>

      <label className="flex items-center gap-2 mb-3">
        <span className="text-gray-700 dark:text-gray-300">{t("yearLabel")}</span>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={`${inputClass} w-28`}
        />
      </label>

      {loadFailed ? (
        <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>
      ) : !status ? (
        <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
      ) : status.approved ? (
        <p className="text-green-700 dark:text-green-400">
          ✅ {t("approved", { year: status.year })}
        </p>
      ) : status.canApprove ? (
        status.viewerCanApprove ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={votingItemId}
              onChange={(e) => setVotingItemId(e.target.value)}
              placeholder={t("votePlaceholder")}
              className={`${inputClass} flex-1 min-w-64 font-mono`}
            />
            <button
              onClick={approve}
              disabled={busy || !votingItemId.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {busy ? t("approving") : t("approve")}
            </button>
            <p className="w-full text-xs text-gray-500 dark:text-gray-400">
              {t("voteHint")}
            </p>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400">{t("chairmanOnly")}</p>
        )
      ) : (
        <p className="text-amber-700 dark:text-amber-400">
          {t("blockedNotPublished")}
        </p>
      )}

      {approveFailed && (
        <p className="mt-2 text-red-600 dark:text-red-400">
          {t("approveError")}
        </p>
      )}
    </div>
  );
}

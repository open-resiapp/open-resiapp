"use client";

// Účtovná závierka approval panel (AC 423/521). Shows the approval state for
// a chosen year and — for the CHAIRMAN only — an approve action gated on a
// recorded zhromaždenie decision. The decision is PICKED from the passed
// items of closed votings whose result is published (fix 2026-11-18 — no
// raw IDs). Approval records the decision; it never posts to the ledger
// (separation of duties).

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

interface EligibleItem {
  votingItemId: string;
  votingTitle: string;
  itemIdx: number;
  itemTitle: string;
  endsAt: string;
  resultPublishedAt: string;
}

interface Status {
  year: number;
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  approved: boolean;
  approvedAt: string | null;
  votingItemId: string | null;
  canApprove: boolean;
  viewerCanApprove: boolean;
  eligibleItems?: EligibleItem[];
}

export default function ZavierkaPanel() {
  const t = useTranslations("Accounting.zavierka");
  const format = useFormatter();
  const [year, setYear] = useState(() => new Date().getUTCFullYear() - 1);
  const [status, setStatus] = useState<Status | null>(null);
  const [votingItemId, setVotingItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    setVotingItemId("");
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
    if (!votingItemId) return;
    setBusy(true);
    setApproveError(null);
    try {
      const res = await fetch("/api/accounting/zavierka", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, votingItemId }),
      });
      if (!res.ok) {
        // The API returns a localized message for each stable code.
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? t("approveError"));
      }
      load();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : t("approveError"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "min-h-11 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base";

  const items = status?.eligibleItems ?? [];
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: "numeric", month: "numeric", year: "numeric" });

  return (
    // id: deep link target from the "Ročné úlohy" hub (/accounting/journal#zavierka).
    <div id="zavierka" className="mb-6 scroll-mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-base">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t("title")}
      </h2>
      <p className="text-gray-700 dark:text-gray-300 mb-3">{t("hint")}</p>

      <label className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-gray-800 dark:text-gray-200">{t("yearLabel")}</span>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={`${inputClass} w-28`}
        />
      </label>

      {loadFailed ? (
        <p className="text-red-700 dark:text-red-400">{t("loadError")}</p>
      ) : !status ? (
        <p className="text-gray-700 dark:text-gray-300">{t("loading")}</p>
      ) : status.approved ? (
        <p className="text-green-700 dark:text-green-400">
          ✅ {t("approved", { year: status.year })}
        </p>
      ) : status.canApprove ? (
        status.viewerCanApprove ? (
          items.length === 0 ? (
            <p className="text-amber-800 dark:text-amber-400">{t("noEligibleVotes")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-gray-800 dark:text-gray-200">{t("voteLabel")}</span>
                <select
                  value={votingItemId}
                  onChange={(e) => setVotingItemId(e.target.value)}
                  className={`${inputClass} w-full max-w-full`}
                >
                  <option value="">{t("votePlaceholder")}</option>
                  {items.map((i) => (
                    <option key={i.votingItemId} value={i.votingItemId}>
                      {t("voteOption", {
                        voting: i.votingTitle,
                        idx: i.itemIdx,
                        item: i.itemTitle,
                        date: date(i.endsAt),
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-gray-700 dark:text-gray-300">{t("voteHint")}</p>
              <div>
                <button
                  onClick={approve}
                  disabled={busy || !votingItemId}
                  className="min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {busy ? t("approving") : t("approve")}
                </button>
              </div>
            </div>
          )
        ) : (
          <p className="text-gray-700 dark:text-gray-300">{t("chairmanOnly")}</p>
        )
      ) : (
        <p className="text-amber-800 dark:text-amber-400">
          {t("blockedNotPublished")}
        </p>
      )}

      {approveError && (
        <p className="mt-2 text-red-700 dark:text-red-400">{approveError}</p>
      )}
    </div>
  );
}

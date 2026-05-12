"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

interface ClaimableUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  suggestions: Array<{
    shellId: string;
    shellName: string;
    flatNumber: string | null;
    score: number;
  }>;
}

interface ShellMergeDialogProps {
  shellId: string;
  shellName: string;
  onClose: () => void;
}

export default function ShellMergeDialog(props: ShellMergeDialogProps) {
  const t = useTranslations("Owners.pending");
  const tCommon = useTranslations("Common");
  const [candidates, setCandidates] = useState<ClaimableUser[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/pending-registrations")
      .then((r) => r.json())
      .then(
        (data: {
          registrants: ClaimableUser[];
        }) => {
          setCandidates(data.registrants);
          setLoading(false);
        }
      )
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [candidates, filter]);

  async function merge() {
    if (!selected) return;
    if (!confirm(t("confirmMerge", { shellName: props.shellName }))) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(
      `/api/admin/shell-users/${props.shellId}/merge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: selected }),
      }
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || tCommon("saveFailed"));
      setSubmitting(false);
      return;
    }
    props.onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("mergeTitle")}
          </h2>
          <button
            onClick={props.onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none dark:text-gray-400 dark:hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
          {t("mergeHint", { shellName: props.shellName })}
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("mergeFilterPlaceholder")}
          className="w-full mb-4 px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        />

        {loading ? (
          <p className="text-base text-gray-500 dark:text-gray-400">
            {tCommon("loading")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-base text-gray-500 dark:text-gray-400">
            {t("mergeNoCandidates")}
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {filtered.map((c) => (
              <label
                key={c.id}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg cursor-pointer border-2 transition-colors ${
                  selected === c.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                    : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                }`}
              >
                <input
                  type="radio"
                  name="merge-target"
                  value={c.id}
                  checked={selected === c.id}
                  onChange={() => setSelected(c.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {c.name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {c.email}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={props.onClose}
            className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-base font-medium rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            {tCommon("cancel")}
          </button>
          <button
            onClick={merge}
            disabled={!selected || submitting}
            className="flex-1 py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white text-base font-medium rounded-lg transition-colors"
          >
            {submitting ? t("merging") : t("merge")}
          </button>
        </div>
      </div>
    </div>
  );
}

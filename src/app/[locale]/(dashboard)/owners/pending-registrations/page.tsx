"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import PendingApprovalModal from "@/components/owners/PendingApprovalModal";

interface ShellMatch {
  shellId: string;
  shellName: string;
  flatNumber: string | null;
  score: number;
}

interface RegistrantRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  suggestions: ShellMatch[];
}

interface ShellOption {
  id: string;
  name: string;
  flatNumber: string | null;
}

export default function PendingRegistrationsPage() {
  const { data: session } = useSession();
  const t = useTranslations("Owners.pendingRegistrations");
  const tCommon = useTranslations("Common");

  const [registrants, setRegistrants] = useState<RegistrantRow[]>([]);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState<RegistrantRow | null>(null);
  const [overrideOpenForId, setOverrideOpenForId] = useState<string | null>(
    null
  );
  const [overrideValueById, setOverrideValueById] = useState<
    Record<string, string>
  >({});

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/pending-registrations");
    if (res.ok) {
      const body = (await res.json()) as {
        registrants: RegistrantRow[];
        shells: ShellOption[];
      };
      setRegistrants(body.registrants);
      setShells(body.shells);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) fetchData();
  }, [canManage, fetchData]);

  if (!canManage) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
        {t("noPermission")}
      </div>
    );
  }

  async function handleMerge(registrant: RegistrantRow, shellId: string) {
    if (!confirm(t("confirmMerge", { name: registrant.name }))) return;
    setBusyId(registrant.id);
    setError(null);
    const res = await fetch(`/api/admin/shell-users/${shellId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: registrant.id }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || tCommon("saveFailed"));
      setBusyId(null);
      return;
    }
    await fetchData();
    setBusyId(null);
  }

  async function handleDismiss(registrant: RegistrantRow) {
    if (!confirm(t("confirmDismiss", { name: registrant.name }))) return;
    setBusyId(registrant.id);
    setError(null);
    const res = await fetch(`/api/registrations/${registrant.id}/reject`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || tCommon("saveFailed"));
      setBusyId(null);
      return;
    }
    await fetchData();
    setBusyId(null);
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">
        {t("title")}
      </h1>
      <p className="text-base text-gray-500 mb-6 dark:text-gray-400">
        {t("subtitle")}
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm p-6 animate-pulse dark:bg-gray-800 dark:shadow-black/40">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 bg-gray-200 rounded dark:bg-gray-700"
              />
            ))}
          </div>
        </div>
      ) : registrants.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {registrants.map((r) => {
            const top = r.suggestions[0] ?? null;
            const override = overrideValueById[r.id] ?? "";
            const isOverrideOpen = overrideOpenForId === r.id;
            const isBusy = busyId === r.id;
            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl shadow-sm p-5 dark:bg-gray-800 dark:shadow-black/40"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {r.name}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {t("submittedAt", {
                        date: new Date(r.createdAt).toLocaleString(),
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDismiss(r)}
                    disabled={isBusy}
                    className="text-sm text-gray-500 hover:text-red-600 underline dark:text-gray-400 dark:hover:text-red-400"
                  >
                    {t("dismiss")}
                  </button>
                </div>

                {top ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/30 dark:border-blue-800">
                    <p className="text-base text-blue-900 dark:text-blue-100 mb-1">
                      {t("suggestion", {
                        shellName: top.shellName,
                        flat: top.flatNumber ?? "?",
                      })}
                    </p>
                    <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                      {t("similarity", { score: Math.round(top.score * 100) })}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleMerge(r, top.shellId)}
                        disabled={isBusy}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {isBusy ? t("merging") : t("merge")}
                      </button>
                      <button
                        onClick={() =>
                          setOverrideOpenForId(isOverrideOpen ? null : r.id)
                        }
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100"
                      >
                        {t("pickDifferent")}
                      </button>
                      <button
                        onClick={() => setApproving(r)}
                        disabled={isBusy}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {t("approveAsNew")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-3 dark:bg-gray-900/50">
                    <p className="text-base text-gray-600 dark:text-gray-300 mb-2">
                      {t("noSuggestion")}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() =>
                          setOverrideOpenForId(isOverrideOpen ? null : r.id)
                        }
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {t("mergeManually")}
                      </button>
                      <button
                        onClick={() => setApproving(r)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {t("approveAsNew")}
                      </button>
                    </div>
                  </div>
                )}

                {isOverrideOpen && (
                  <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      {t("pickShellLabel")}
                    </label>
                    <select
                      value={override}
                      onChange={(e) =>
                        setOverrideValueById((prev) => ({
                          ...prev,
                          [r.id]: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                    >
                      <option value="">{t("pickShellPlaceholder")}</option>
                      {shells.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.flatNumber ? ` (${s.flatNumber})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => override && handleMerge(r, override)}
                      disabled={!override || isBusy}
                      className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {isBusy ? t("merging") : t("merge")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {approving && (
        <PendingApprovalModal
          user={{
            id: approving.id,
            name: approving.name,
            email: approving.email,
          }}
          onClose={() => setApproving(null)}
          onApproved={() => {
            setApproving(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

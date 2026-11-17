"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

// Profile → "Pripojené AI aplikácie" (BYT-20261117-001 §2). Renders nothing
// while the `mcp` module is disabled (the API answers 404).

interface Grant {
  familyId: string;
  clientName: string;
  clientId: string;
  logoUri: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const SCOPE_KEYS: Record<string, string> = {
  read: "read",
  "finance:read": "finance_read",
  "finance:write": "finance_write",
  "governance:write": "governance_write",
  vote: "vote",
};

export default function ConnectedAiApps() {
  const t = useTranslations("Mcp.profile");
  const tScopes = useTranslations("Mcp.scopeNames");
  const format = useFormatter();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/ai-apps");
      if (res.status === 404) {
        setEnabled(false);
        return;
      }
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { grants: Grant[] };
      setGrants(data.grants);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/profile/ai-apps?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("revoke");
      setConfirmId(null);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 dark:bg-gray-800 dark:shadow-black/40">
      <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">{t("title")}</h2>
      <p className="text-base text-gray-600 mb-4 dark:text-gray-300">{t("description")}</p>

      {error && (
        <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base dark:bg-red-900/30 dark:text-red-200">
          {t("error")}
        </div>
      )}

      {grants === null ? (
        <p className="text-base text-gray-500 dark:text-gray-400">{t("loading")}</p>
      ) : grants.length === 0 ? (
        <p className="text-base text-gray-500 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {grants.map((g) => (
            <li key={g.familyId} className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                {g.logoUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.logoUri}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg object-contain"
                  />
                )}
                <div>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">{g.clientName}</p>
                  <p className="text-base text-gray-600 dark:text-gray-300">
                    {t("scopes")}:{" "}
                    {g.scopes.map((s) => (SCOPE_KEYS[s] ? tScopes(SCOPE_KEYS[s]) : s)).join(", ")}
                  </p>
                  <p className="text-base text-gray-500 dark:text-gray-400">
                    {g.lastUsedAt
                      ? t("lastUsed", {
                          date: format.dateTime(new Date(g.lastUsedAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })
                      : t("neverUsed")}
                  </p>
                </div>
              </div>
              {confirmId === g.familyId ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revoke(g.familyId)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-base font-medium rounded-lg"
                  >
                    {t("confirmRevoke")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmId(null)}
                    className="px-4 py-2 border border-gray-300 text-base font-medium rounded-lg text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(g.familyId)}
                  className="px-4 py-2 border border-red-300 text-red-700 text-base font-medium rounded-lg hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
                >
                  {t("revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

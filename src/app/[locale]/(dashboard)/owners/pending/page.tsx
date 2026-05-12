"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import ShellClaimDialog from "@/components/owners/ShellClaimDialog";
import ShellMergeDialog from "@/components/owners/ShellMergeDialog";

interface ShellUser {
  id: string;
  name: string;
  email: string | null;
  flatNumber: string | null;
  shareNumerator: number;
  shareDenominator: number;
  hasOpenInvite: boolean;
}

type DialogState =
  | { kind: "none" }
  | { kind: "claim"; shell: ShellUser; mode: "email" | "qr" }
  | { kind: "merge"; shell: ShellUser };

export default function PendingShellUsersPage() {
  const { data: session } = useSession();
  const t = useTranslations("Owners.pending");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const [shells, setShells] = useState<ShellUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchShells = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/shell-users");
    if (res.ok) {
      const body = (await res.json()) as { shells: ShellUser[] };
      setShells(body.shells);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) fetchShells();
  }, [canManage, fetchShells]);

  if (!canManage) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
        {t("noPermission")}
      </div>
    );
  }

  const filtered = filter.trim()
    ? shells.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          (s.flatNumber ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : shells;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
      </div>
      <p className="text-base text-gray-500 mb-6 dark:text-gray-400">
        {t("counter", { count: shells.length })}
      </p>

      <div className="mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("filterPlaceholder")}
          className="w-full max-w-sm px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse dark:bg-gray-800 dark:border-gray-700">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded dark:bg-gray-700" />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
          {t("empty")}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden dark:bg-gray-800 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("nameLabel")}
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("flatLabel")}
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("shareLabel")}
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("emailLabel")}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-6 py-4 text-base text-gray-900 font-medium dark:text-gray-100">
                      {s.name}
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">
                      {s.flatNumber || tCommon("noDash")}
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">
                      {s.shareNumerator}/{s.shareDenominator}
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">
                      {s.email ?? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {t("emailMissing")}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2 justify-end flex-wrap">
                        <button
                          onClick={() =>
                            setDialog({ kind: "claim", shell: s, mode: "email" })
                          }
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {s.email ? t("sendInvitation") : t("addEmailAndInvite")}
                        </button>
                        <button
                          onClick={() =>
                            setDialog({ kind: "claim", shell: s, mode: "qr" })
                          }
                          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100"
                        >
                          {t("showQr")}
                        </button>
                        <button
                          onClick={() =>
                            setDialog({ kind: "merge", shell: s })
                          }
                          className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {t("assignExisting")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog.kind === "claim" && (
        <ShellClaimDialog
          shellId={dialog.shell.id}
          shellName={dialog.shell.name}
          existingEmail={dialog.shell.email}
          mode={dialog.mode}
          locale={locale}
          onClose={() => {
            setDialog({ kind: "none" });
            fetchShells();
          }}
        />
      )}

      {dialog.kind === "merge" && (
        <ShellMergeDialog
          shellId={dialog.shell.id}
          shellName={dialog.shell.name}
          onClose={() => {
            setDialog({ kind: "none" });
            fetchShells();
          }}
        />
      )}
    </div>
  );
}

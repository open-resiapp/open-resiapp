"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import PendingApprovalModal from "@/components/owners/PendingApprovalModal";

interface PendingUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface PendingResponse {
  verified: PendingUser[];
  unverified: PendingUser[];
}

export default function PendingRegistrationsPage() {
  const { data: session } = useSession();
  const t = useTranslations("PendingRegistrations");
  const tCommon = useTranslations("Common");

  const [data, setData] = useState<PendingResponse>({
    verified: [],
    unverified: [],
  });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PendingUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchPending = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/registrations/pending");
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) fetchPending();
  }, [canManage, fetchPending]);

  if (!canManage) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
        {t("noPermission")}
      </div>
    );
  }

  async function handleReject(user: PendingUser) {
    if (!confirm(t("confirmReject", { name: user.name }))) return;
    setError(null);
    const res = await fetch(`/api/registrations/${user.id}/reject`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || tCommon("saveFailed"));
      return;
    }
    fetchPending();
  }

  function renderRow(user: PendingUser, isVerified: boolean) {
    return (
      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
        <td className="px-6 py-4 text-base text-gray-900 font-medium dark:text-gray-100">
          {user.name}
        </td>
        <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">{user.email}</td>
        <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">
          {user.phone || tCommon("noDash")}
        </td>
        <td className="px-6 py-4 text-base text-gray-600 dark:text-gray-300">
          {new Date(user.createdAt).toLocaleString()}
        </td>
        <td className="px-6 py-4">
          {isVerified && (
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSelected(user)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("approve")}
              </button>
              <button
                onClick={() => handleReject(user)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("reject")}
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">{t("title")}</h1>
      <p className="text-base text-gray-500 mb-6 dark:text-gray-400">{t("subtitle")}</p>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse dark:bg-gray-800 dark:border-gray-700">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded dark:bg-gray-700" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">
              {t("verifiedHeading", { count: data.verified.length })}
            </h2>
            {data.verified.length === 0 ? (
              <p className="text-base text-gray-500 dark:text-gray-400">{t("verifiedEmpty")}</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden dark:bg-gray-800 dark:border-gray-700">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("nameLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("emailLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("phoneLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("submittedLabel")}
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.verified.map((u) => renderRow(u, true))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">
              {t("unverifiedHeading", { count: data.unverified.length })}
            </h2>
            {data.unverified.length === 0 ? (
              <p className="text-base text-gray-500 dark:text-gray-400">{t("unverifiedEmpty")}</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden dark:bg-gray-800 dark:border-gray-700">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-900 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("nameLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("emailLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("phoneLabel")}
                      </th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                        {t("submittedLabel")}
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.unverified.map((u) => renderRow(u, false))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {selected && (
        <PendingApprovalModal
          user={selected}
          onClose={() => setSelected(null)}
          onApproved={() => {
            setSelected(null);
            fetchPending();
          }}
        />
      )}
    </div>
  );
}

"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import PushSubscriptionManager from "@/components/notifications/PushSubscriptionManager";
import NotificationPreferences from "@/components/notifications/NotificationPreferences";
import ConsentManagement from "@/components/consent/ConsentManagement";
import type { UserRole } from "@/types";

const roleKeys: Record<UserRole, string> = {
  admin: "roleAdmin",
  owner: "roleOwner",
  tenant: "roleTenant",
  vote_counter: "roleVoteCounter",
  caretaker: "roleCaretaker",
};

export default function ProfilePage() {
  const { data: session } = useSession();
  const t = useTranslations("Profile");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    setSaving(true);

    const res = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!res.ok) {
      const data = await res.json();
      if (data.error?.includes("aktuálne heslo") || data.error?.includes("current password")) {
        setError(t("wrongPassword"));
      } else {
        setError(t("passwordChangeFailed"));
      }
      setSaving(false);
      return;
    }

    setSuccess(t("passwordChanged"));
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSaving(false);
  }

  if (!session) return null;

  const role = session.user.role as UserRole;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>

      {/* User info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t("userInfo")}
        </h2>
        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">{t("nameLabel")}</dt>
            <dd className="text-base text-gray-900">{session.user.name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">{t("emailLabel")}</dt>
            <dd className="text-base text-gray-900">{session.user.email}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">{t("roleLabel")}</dt>
            <dd className="text-base text-gray-900">{t(roleKeys[role])}</dd>
          </div>
        </dl>
      </div>

      {/* Change password card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t("changePassword")}
        </h2>

        <form onSubmit={handleChangePassword} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-base">
              {success}
            </div>
          )}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("currentPassword")}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("newPassword")}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("confirmPassword")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
          >
            {saving ? t("changing") : t("changePasswordButton")}
          </button>
        </form>
      </div>

      {/* Consent management */}
      <ConsentManagement />

      {/* Notifications card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t("notifications")}
        </h2>
        <div className="space-y-6">
          <PushSubscriptionManager />
          <hr className="border-gray-200" />
          <NotificationPreferences />
        </div>
      </div>
    </div>
  );
}

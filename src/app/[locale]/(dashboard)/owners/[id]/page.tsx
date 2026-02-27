"use client";

import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

interface UserDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  flatId: string | null;
  flatNumber: string | null;
  floor: number | null;
  entranceId: string | null;
  entranceName: string | null;
  createdAt: string;
}

interface FlatOption {
  id: string;
  flatNumber: string;
  entranceName: string;
}

const roleKeys: Record<UserRole, string> = {
  admin: "roleAdmin",
  owner: "roleOwner",
  tenant: "roleTenant",
  vote_counter: "roleVoteCounter",
};

export default function UserDetailPage() {
  const { data: session } = useSession();
  const t = useTranslations("Owners");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const params = useParams();
  const id = params.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flats, setFlats] = useState<FlatOption[]>([]);

  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("owner");
  const [editFlatId, setEditFlatId] = useState("");

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchUser = useCallback(async () => {
    const res = await fetch(`/api/users/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setUser(data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    async function loadFlats() {
      const res = await fetch("/api/flats");
      if (res.ok) {
        setFlats(await res.json());
      }
    }
    if (canManage) loadFlats();
  }, [canManage]);

  function startEditing() {
    if (!user) return;
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPhone(user.phone || "");
    setEditRole(user.role);
    setEditFlatId(user.flatId || "");
    setError("");
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        email: editEmail,
        phone: editPhone || null,
        role: editRole,
        flatId: editFlatId || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || tCommon("saveFailed"));
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditing(false);
    await fetchUser();
  }

  async function toggleActive() {
    if (!user) return;
    setSaving(true);

    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.isActive }),
    });

    if (res.ok) {
      await fetchUser();
    }
    setSaving(false);
  }

  if (!canManage) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        {t("noPermission")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/4" />
        <div className="h-8 bg-gray-200 rounded w-2/3" />
        <div className="h-48 bg-gray-200 rounded" />
      </div>
    );
  }

  if (notFound || !user) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-500 mb-4">{t("userNotFound")}</p>
        <Link href="/owners" className="text-blue-600 hover:underline text-base">
          {tCommon("backToList")}
        </Link>
      </div>
    );
  }

  function flatDisplay() {
    if (!user?.flatNumber) return tCommon("noDash");
    if (user.floor !== null && user.entranceName) {
      return t("flatDisplay", {
        number: user.flatNumber,
        floor: user.floor,
        entrance: user.entranceName,
      });
    }
    if (user.entranceName) {
      return t("flatDisplayNoFloor", {
        number: user.flatNumber,
        entrance: user.entranceName,
      });
    }
    return `${t("flatLabel")} ${user.flatNumber}`;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/owners"
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; {tCommon("backToList")}
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${
                user.isActive
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {user.isActive ? t("statusActive") : t("statusInactive")}
            </span>
          </div>
        </div>

        {!editing ? (
          <>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">{t("emailLabel")}</dt>
                <dd className="text-base text-gray-900">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t("phoneLabel")}</dt>
                <dd className="text-base text-gray-900">{user.phone || tCommon("noDash")}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t("roleLabel")}</dt>
                <dd className="text-base text-gray-900">{t(roleKeys[user.role])}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t("flatLabel")}</dt>
                <dd className="text-base text-gray-900">{flatDisplay()}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t("registered")}</dt>
                <dd className="text-base text-gray-900">
                  {format.dateTime(new Date(user.createdAt), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>

            <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
              <button
                onClick={startEditing}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
              >
                {tCommon("edit")}
              </button>
              <button
                onClick={toggleActive}
                disabled={saving}
                className={`px-5 py-3 text-base font-medium rounded-lg transition-colors ${
                  user.isActive
                    ? "bg-red-100 hover:bg-red-200 text-red-700"
                    : "bg-green-100 hover:bg-green-200 text-green-700"
                }`}
              >
                {user.isActive ? t("deactivate") : t("activate")}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {t("nameLabel")}
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {t("emailLabel")}
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {t("phoneLabel")}
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {t("roleLabel")}
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="owner">{t("roleOwner")}</option>
                  <option value="tenant">{t("roleTenant")}</option>
                  <option value="admin">{t("roleAdmin")}</option>
                  <option value="vote_counter">{t("roleVoteCounter")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                {t("flatLabel")}
              </label>
              <select
                value={editFlatId}
                onChange={(e) => setEditFlatId(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="">{t("noFlat")}</option>
                {flats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {t("flatLabel")} {f.flatNumber} ({f.entranceName})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {saving ? tCommon("saving") : tCommon("save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

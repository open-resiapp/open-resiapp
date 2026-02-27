"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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

const roleLabels: Record<UserRole, string> = {
  admin: "Administrátor",
  owner: "Vlastník",
  tenant: "Nájomca",
  vote_counter: "Zapisovateľ",
};

export default function UserDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flats, setFlats] = useState<FlatOption[]>([]);

  // Edit form state
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
      setError(data.error || "Nepodarilo sa uložiť zmeny");
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
        Nemáte oprávnenie na správu vlastníkov.
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
        <p className="text-lg text-gray-500 mb-4">Používateľ nenájdený.</p>
        <Link href="/owners" className="text-blue-600 hover:underline text-base">
          Späť na zoznam
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/owners"
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; Späť na zoznam
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
              {user.isActive ? "Aktívny" : "Neaktívny"}
            </span>
          </div>
        </div>

        {!editing ? (
          <>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Email</dt>
                <dd className="text-base text-gray-900">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Telefón</dt>
                <dd className="text-base text-gray-900">{user.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Rola</dt>
                <dd className="text-base text-gray-900">{roleLabels[user.role]}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Byt</dt>
                <dd className="text-base text-gray-900">
                  {user.flatNumber
                    ? `Byt ${user.flatNumber}${user.floor !== null ? `, ${user.floor}. poschodie` : ""}${user.entranceName ? ` (${user.entranceName})` : ""}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Registrovaný</dt>
                <dd className="text-base text-gray-900">
                  {new Date(user.createdAt).toLocaleDateString("sk-SK", {
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
                Upraviť
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
                {user.isActive ? "Deaktivovať" : "Aktivovať"}
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
                  Meno
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
                  Email
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
                  Telefón
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  Rola
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="owner">Vlastník</option>
                  <option value="tenant">Nájomca</option>
                  <option value="admin">Administrátor</option>
                  <option value="vote_counter">Zapisovateľ</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Byt
              </label>
              <select
                value={editFlatId}
                onChange={(e) => setEditFlatId(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="">Bez bytu</option>
                {flats.map((f) => (
                  <option key={f.id} value={f.id}>
                    Byt {f.flatNumber} ({f.entranceName})
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
                Zrušiť
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {saving ? "Ukladám..." : "Uložiť"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

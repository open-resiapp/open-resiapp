"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

interface UserData {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  flatNumber: string | null;
  createdAt: string;
}

const roleLabels: Record<UserRole, string> = {
  admin: "Administrátor",
  owner: "Vlastník",
  tenant: "Nájomca",
  vote_counter: "Zapisovateľ",
};

export default function VlastniciPage() {
  const { data: session } = useSession();
  const [usersList, setUsersList] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const role = (session?.user?.role || "owner") as UserRole;

  if (!hasPermission(role, "manageUsers")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        Nemáte oprávnenie na správu vlastníkov.
      </div>
    );
  }

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.ok) {
      setUsersList(await res.json());
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetchUsers();
  }, []);

  async function handleAddUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormLoading(true);
    setFormError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        phone: formData.get("phone"),
        role: formData.get("role"),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setFormError(data.error || "Nepodarilo sa vytvoriť používateľa");
      setFormLoading(false);
      return;
    }

    setFormLoading(false);
    setShowForm(false);
    fetchUsers();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Vlastníci a užívatelia</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
        >
          {showForm ? "Zavrieť" : "Pridať používateľa"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Nový používateľ
          </h2>
          {formError && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
              {formError}
            </div>
          )}
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  Meno
                </label>
                <input
                  name="name"
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  Heslo
                </label>
                <input
                  name="password"
                  type="password"
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  Telefón
                </label>
                <input
                  name="phone"
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Rola
              </label>
              <select
                name="role"
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="owner">Vlastník</option>
                <option value="tenant">Nájomca</option>
                <option value="admin">Administrátor</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={formLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {formLoading ? "Ukladám..." : "Pridať"}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      ) : usersList.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg">
          Žiadni používatelia.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                    Meno
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                    Email
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                    Byt
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                    Rola
                  </th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                    Stav
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-base text-gray-900">
                      <Link href={`/owners/${u.id}`} className="text-blue-600 hover:underline">
                        {u.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600">
                      {u.email}
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600">
                      {u.flatNumber || "—"}
                    </td>
                    <td className="px-6 py-4 text-base text-gray-600">
                      {roleLabels[u.role]}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${
                          u.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.isActive ? "Aktívny" : "Neaktívny"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export default function NovaHlasovaniePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const role = (session?.user?.role || "owner") as UserRole;

  if (!hasPermission(role, "createVoting")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        Nemáte oprávnenie vytvárať hlasovania.
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/votings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        description: formData.get("description"),
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
        status: formData.get("status"),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Nepodarilo sa vytvoriť hlasovanie");
      setLoading(false);
      return;
    }

    const voting = await res.json();
    router.push(`/voting/${voting.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; Späť na zoznam
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Nové hlasovanie
        </h1>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Názov hlasovania
            </label>
            <input
              name="title"
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Napr.: Oprava strechy bytového domu"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Popis (voliteľné)
            </label>
            <textarea
              name="description"
              rows={4}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical"
              placeholder="Podrobný popis hlasovania..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Začiatok
              </label>
              <input
                name="startsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Koniec
              </label>
              <input
                name="endsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Stav
            </label>
            <select
              name="status"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="draft">Návrh</option>
              <option value="active">Aktívne (ihneď spustiť)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => router.push("/voting")}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? "Vytváram..." : "Vytvoriť hlasovanie"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

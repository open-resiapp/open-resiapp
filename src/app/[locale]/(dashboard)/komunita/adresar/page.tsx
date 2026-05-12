"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import DirectoryEditModal from "@/components/community/DirectoryEditModal";
import type { UserRole } from "@/types";

interface DirectoryEntry {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  skills: string | null;
  sharePhone: boolean;
  shareEmail: boolean;
  flatNumber: string | null;
  entranceName: string | null;
}

const EMPTY_VALUES = {
  sharePhone: false,
  shareEmail: false,
  note: "",
  skills: "",
};

export default function DirectoryPage() {
  const { data: session } = useSession();
  const t = useTranslations("Community");
  const tDir = useTranslations("Community.directory");
  const tCommon = useTranslations("Common");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  const role = (session?.user?.role || "owner") as UserRole;
  const userId = session?.user?.id;
  const isAdmin = role === "admin";

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/community/directory");
      if (res.ok) setEntries(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const myEntry = useMemo(
    () => entries.find((e) => e.userId === userId) || null,
    [entries, userId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const parts = [
        e.name,
        e.skills ?? "",
        e.note ?? "",
        e.flatNumber ?? "",
        e.entranceName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return parts.includes(q);
    });
  }, [entries, search]);

  async function handleSave(values: typeof EMPTY_VALUES) {
    const res = await fetch("/api/community/directory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) fetchEntries();
  }

  async function handleDeleteOwn() {
    const res = await fetch("/api/community/directory", { method: "DELETE" });
    if (res.ok) fetchEntries();
  }

  async function handleAdminDelete(entry: DirectoryEntry) {
    if (!confirm(tDir("adminConfirmDelete", { name: entry.name }))) return;
    const res = await fetch(`/api/community/directory/${entry.userId}`, {
      method: "DELETE",
    });
    if (res.ok) fetchEntries();
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-gray-500 mb-1 dark:text-gray-400">
            <Link href="/komunita" className="hover:underline">
              {t("landing.title")}
            </Link>
            {" / "}
            <span>{tDir("title")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tDir("title")}</h1>
          <p className="text-base text-gray-600 mt-1 dark:text-gray-300">{tDir("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowEdit(true)}
          className="px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          {tDir("editMine")}
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tDir("searchPlaceholder")}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100 dark:placeholder-gray-500"
        />
      </div>

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">{tCommon("loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-800 dark:shadow-black/40">
          <p className="text-gray-600 mb-4 dark:text-gray-300">{tDir("empty")}</p>
          <button
            onClick={() => setShowEdit(true)}
            className="inline-block px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            {tDir("editMine")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="bg-white rounded-2xl shadow-sm p-5 dark:bg-gray-800 dark:shadow-black/40"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {e.name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {[
                      e.flatNumber && `${tDir("flat")} ${e.flatNumber}`,
                      e.entranceName,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                {isAdmin && e.userId !== userId && (
                  <button
                    onClick={() => handleAdminDelete(e)}
                    className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {tDir("adminDelete")}
                  </button>
                )}
              </div>
              <div className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
                {e.phone && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">📞 </span>
                    <a
                      href={`tel:${e.phone}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {e.phone}
                    </a>
                  </div>
                )}
                {e.email && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">✉️ </span>
                    <a
                      href={`mailto:${e.email}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {e.email}
                    </a>
                  </div>
                )}
                {e.skills && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">🔧 </span>
                    {e.skills}
                  </div>
                )}
                {e.note && <p className="text-gray-600 italic dark:text-gray-300">&ldquo;{e.note}&rdquo;</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <DirectoryEditModal
        open={showEdit}
        initial={
          myEntry
            ? {
                sharePhone: myEntry.sharePhone,
                shareEmail: myEntry.shareEmail,
                note: myEntry.note ?? "",
                skills: myEntry.skills ?? "",
              }
            : EMPTY_VALUES
        }
        hasEntry={!!myEntry}
        onClose={() => setShowEdit(false)}
        onSave={handleSave}
        onDelete={handleDeleteOwn}
      />
    </div>
  );
}

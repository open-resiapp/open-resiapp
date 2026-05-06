"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";

interface Entrance {
  id: string;
  name: string;
  streetNumber: string | null;
  flatCount: number;
}

interface EntrancesTabProps {
  canEdit: boolean;
}

export default function EntrancesTab({ canEdit }: EntrancesTabProps) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Add/edit form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formStreetNumber, setFormStreetNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchEntrances = async () => {
    try {
      const res = await fetch("/api/entrances");
      if (res.ok) setEntrances(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchEntrances(); }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormStreetNumber("");
  };

  const handleEdit = (entrance: Entrance) => {
    setEditingId(entrance.id);
    setFormName(entrance.name);
    setFormStreetNumber(entrance.streetNumber || "");
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const url = editingId ? `/api/entrances/${editingId}` : "/api/entrances";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, streetNumber: formStreetNumber || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      resetForm();
      setMessage({ type: "success", text: t("entranceSaved") });
      await fetchEntrances();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : t("entranceSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDeleteEntrance"))) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/entrances/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage({ type: "success", text: t("entranceDeleted") });
      await fetchEntrances();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : t("entranceDeleteFailed") });
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3 dark:bg-gray-700" />
        <div className="h-32 bg-gray-200 rounded dark:bg-gray-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("entrances")}</h2>
        {canEdit && !showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            {t("addEntrance")}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-base ${
            message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {showForm && canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4 dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-base font-bold text-gray-900 mb-4 dark:text-gray-100">
            {editingId ? t("editEntrance") : t("addEntrance")}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("entranceName")}</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("streetNumber")}</label>
              <input
                type="text"
                value={formStreetNumber}
                onChange={(e) => setFormStreetNumber(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !formName}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? tc("saving") : tc("save")}
              </button>
              <button
                onClick={resetForm}
                className="px-5 py-3 text-gray-700 hover:text-gray-900 text-base font-medium transition-colors dark:text-gray-200 dark:hover:text-gray-100"
              >
                {tc("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {entrances.length === 0 ? (
        <p className="text-base text-gray-500 dark:text-gray-400">{t("noEntrances")}</p>
      ) : (
        <div className="space-y-3">
          {entrances.map((entrance) => (
            <div
              key={entrance.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between dark:bg-gray-800 dark:border-gray-700"
            >
              <div>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">{entrance.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {entrance.streetNumber && `${t("streetNumber")}: ${entrance.streetNumber} · `}
                  {t("flatCount")}: {entrance.flatCount}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(entrance)}
                    className="px-4 py-2 text-base text-blue-600 hover:text-blue-700 font-medium transition-colors dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {tc("edit")}
                  </button>
                  <button
                    onClick={() => handleDelete(entrance.id)}
                    className="px-4 py-2 text-base text-red-600 hover:text-red-700 font-medium transition-colors dark:text-red-400 dark:hover:text-red-300"
                  >
                    {tc("delete")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

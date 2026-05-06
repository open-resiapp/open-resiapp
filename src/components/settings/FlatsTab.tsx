"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";

interface FlatRow {
  id: string;
  flatNumber: string;
  floor: number;
  area: number | null;
  shareNumerator: number;
  shareDenominator: number;
  entranceId: string;
  entranceName: string | null;
}

interface Entrance {
  id: string;
  name: string;
}

interface FlatsTabProps {
  canEdit: boolean;
}

export default function FlatsTab({ canEdit }: FlatsTabProps) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [flatsList, setFlatsList] = useState<FlatRow[]>([]);
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formEntranceId, setFormEntranceId] = useState("");
  const [formFlatNumber, setFormFlatNumber] = useState("");
  const [formFloor, setFormFloor] = useState("0");
  const [formArea, setFormArea] = useState("");
  const [formShareNum, setFormShareNum] = useState("");
  const [formShareDen, setFormShareDen] = useState("10000");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      const [flatsRes, entrancesRes] = await Promise.all([
        fetch("/api/flats"),
        fetch("/api/entrances"),
      ]);
      if (flatsRes.ok) setFlatsList(await flatsRes.json());
      if (entrancesRes.ok) setEntrances(await entrancesRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormEntranceId("");
    setFormFlatNumber("");
    setFormFloor("0");
    setFormArea("");
    setFormShareNum("");
    setFormShareDen("10000");
  };

  const handleEdit = (flat: FlatRow) => {
    setEditingId(flat.id);
    setFormEntranceId(flat.entranceId);
    setFormFlatNumber(flat.flatNumber);
    setFormFloor(String(flat.floor));
    setFormArea(flat.area !== null ? String(flat.area) : "");
    setFormShareNum(String(flat.shareNumerator));
    setFormShareDen(String(flat.shareDenominator));
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        entranceId: formEntranceId,
        flatNumber: formFlatNumber,
        floor: parseInt(formFloor) || 0,
        area: formArea ? parseInt(formArea) : null,
        shareNumerator: parseInt(formShareNum),
        shareDenominator: parseInt(formShareDen),
      };

      const url = editingId ? `/api/flats/${editingId}` : "/api/flats";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      resetForm();
      setMessage({ type: "success", text: t("flatSaved") });
      await fetchData();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : t("flatSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDeleteFlat"))) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/flats/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage({ type: "success", text: t("flatDeleted") });
      await fetchData();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : t("flatDeleteFailed") });
    }
  };

  // Group flats by entrance
  const flatsByEntrance = flatsList.reduce<Record<string, FlatRow[]>>((acc, flat) => {
    const key = flat.entranceName || "—";
    if (!acc[key]) acc[key] = [];
    acc[key].push(flat);
    return acc;
  }, {});

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
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("flats")}</h2>
        {canEdit && !showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            {t("addFlat")}
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
            {editingId ? t("editFlat") : t("addFlat")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("entrance")}</label>
              <select
                value={formEntranceId}
                onChange={(e) => setFormEntranceId(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">—</option>
                {entrances.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("flatNumber")}</label>
              <input
                type="text"
                value={formFlatNumber}
                onChange={(e) => setFormFlatNumber(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("floor")}</label>
              <input
                type="number"
                value={formFloor}
                onChange={(e) => setFormFloor(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("area")}</label>
              <input
                type="number"
                value={formArea}
                onChange={(e) => setFormArea(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("shareNumerator")}</label>
              <input
                type="number"
                value={formShareNum}
                onChange={(e) => setFormShareNum(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1 dark:text-gray-400">{t("shareDenominator")}</label>
              <input
                type="number"
                value={formShareDen}
                onChange={(e) => setFormShareDen(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving || !formEntranceId || !formFlatNumber || !formShareNum || !formShareDen}
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
      )}

      {flatsList.length === 0 ? (
        <p className="text-base text-gray-500 dark:text-gray-400">{t("noFlats")}</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(flatsByEntrance).map(([entranceName, flats]) => (
            <div key={entranceName}>
              <h3 className="text-base font-semibold text-gray-700 mb-2 dark:text-gray-200">{entranceName}</h3>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden dark:bg-gray-800 dark:border-gray-700">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t("flatNumber")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t("floor")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t("area")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t("shareNumerator")}/{t("shareDenominator")}</th>
                      {canEdit && (
                        <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400"></th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {flats.map((flat) => (
                      <tr key={flat.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{flat.flatNumber}</td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{flat.floor}</td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{flat.area !== null ? `${flat.area} m²` : "—"}</td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{flat.shareNumerator}/{flat.shareDenominator}</td>
                        {canEdit && (
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleEdit(flat)}
                              className="text-blue-600 hover:text-blue-700 font-medium mr-3 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              {tc("edit")}
                            </button>
                            <button
                              onClick={() => handleDelete(flat.id)}
                              className="text-red-600 hover:text-red-700 font-medium dark:text-red-400 dark:hover:text-red-300"
                            >
                              {tc("delete")}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

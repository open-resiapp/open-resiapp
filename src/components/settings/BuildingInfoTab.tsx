"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";

interface BuildingInfo {
  id: string;
  name: string;
  address: string;
  ico: string | null;
  votingMethod: string;
}

interface BuildingInfoTabProps {
  canEdit: boolean;
}

export default function BuildingInfoTab({ canEdit }: BuildingInfoTabProps) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [building, setBuilding] = useState<BuildingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [ico, setIco] = useState("");

  useEffect(() => {
    fetch("/api/building")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setBuilding(data);
        if (data) {
          setName(data.name);
          setAddress(data.address);
          setIco(data.ico || "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/building", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, ico: ico || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      const updated = await res.json();
      setBuilding(updated);
      setEditing(false);
      setMessage({ type: "success", text: t("buildingSaved") });
    } catch {
      setMessage({ type: "error", text: t("buildingSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (building) {
      setName(building.name);
      setAddress(building.address);
      setIco(building.ico || "");
    }
    setEditing(false);
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!building && !canEdit) {
    return <p className="text-base text-gray-500">{t("noInfo")}</p>;
  }

  if (!building) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">{t("buildingInfo")}</h2>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg text-base ${
              message.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <p className="text-base text-gray-500 mb-4">{t("noInfo")}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("name")} *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("address")} *</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("ico")}</label>
            <input
              type="text"
              value={ico}
              onChange={(e) => setIco(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !name || !address}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? tc("saving") : tc("save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">{t("buildingInfo")}</h2>
        {canEdit && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-4 py-2 text-base text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            {tc("edit")}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-base ${
            message.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("address")}</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("ico")}</label>
            <input
              type="text"
              value={ico}
              onChange={(e) => setIco(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? tc("saving") : tc("save")}
            </button>
            <button
              onClick={handleCancel}
              className="px-5 py-3 text-gray-700 hover:text-gray-900 text-base font-medium transition-colors"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-gray-500">{t("name")}</dt>
            <dd className="text-base text-gray-900">{building.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">{t("address")}</dt>
            <dd className="text-base text-gray-900">{building.address}</dd>
          </div>
          {building.ico && (
            <div>
              <dt className="text-sm text-gray-500">{t("ico")}</dt>
              <dd className="text-base text-gray-900">{building.ico}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

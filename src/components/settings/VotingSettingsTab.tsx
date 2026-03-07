"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import type { VotingMethod } from "@/types";

interface VotingSettingsTabProps {
  canEdit: boolean;
}

const methods: { value: VotingMethod; labelKey: string; descKey: string }[] = [
  { value: "per_share", labelKey: "votingMethodPerShare", descKey: "votingMethodPerShareDesc" },
  { value: "per_flat", labelKey: "votingMethodPerFlat", descKey: "votingMethodPerFlatDesc" },
  { value: "per_area", labelKey: "votingMethodPerArea", descKey: "votingMethodPerAreaDesc" },
];

export default function VotingSettingsTab({ canEdit }: VotingSettingsTabProps) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [currentMethod, setCurrentMethod] = useState<VotingMethod>("per_share");
  const [selectedMethod, setSelectedMethod] = useState<VotingMethod>("per_share");
  const [legalNotice, setLegalNotice] = useState("");
  const [savedLegalNotice, setSavedLegalNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);
  const [missingAreas, setMissingAreas] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/building").then((r) => r.ok ? r.json() : null),
      fetch("/api/flats").then((r) => r.ok ? r.json() : []),
    ]).then(([building, flats]) => {
      if (building?.votingMethod) {
        setCurrentMethod(building.votingMethod);
        setSelectedMethod(building.votingMethod);
      }
      if (building?.legalNotice != null) {
        setLegalNotice(building.legalNotice);
        setSavedLegalNotice(building.legalNotice);
      }
      const hasNullAreas = flats.some((f: { area: number | null }) => f.area === null);
      setMissingAreas(hasNullAreas);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/building", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votingMethod: selectedMethod }),
      });
      if (!res.ok) throw new Error();
      setCurrentMethod(selectedMethod);
      setMessage({ type: "success", text: t("votingMethodSaved") });
    } catch {
      setMessage({ type: "error", text: t("votingMethodSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  const hasChanges = selectedMethod !== currentMethod;
  const hasNoticeChanges = legalNotice !== savedLegalNotice;

  const handleSaveNotice = async () => {
    setSavingNotice(true);
    setMessage(null);
    try {
      const res = await fetch("/api/building", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalNotice: legalNotice || null }),
      });
      if (!res.ok) throw new Error();
      setSavedLegalNotice(legalNotice);
      setMessage({ type: "success", text: t("legalNoticeSaved") });
    } catch {
      setMessage({ type: "error", text: t("legalNoticeSaveFailed") });
    } finally {
      setSavingNotice(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">{t("votingSettings")}</h2>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-base ${
            message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-3">
        {methods.map((method) => (
          <label
            key={method.value}
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedMethod === method.value
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            } ${!canEdit ? "cursor-default" : ""}`}
          >
            <input
              type="radio"
              name="votingMethod"
              value={method.value}
              checked={selectedMethod === method.value}
              onChange={() => canEdit && setSelectedMethod(method.value)}
              disabled={!canEdit}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <div>
              <p className="text-base font-medium text-gray-900">{t(method.labelKey)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{t(method.descKey)}</p>
            </div>
          </label>
        ))}
      </div>

      {selectedMethod === "per_area" && missingAreas && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-base text-yellow-700">
          {t("missingAreaWarning")}
        </div>
      )}

      {canEdit && hasChanges && (
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? tc("saving") : tc("save")}
          </button>
          <button
            onClick={() => setSelectedMethod(currentMethod)}
            className="px-5 py-3 text-gray-700 hover:text-gray-900 text-base font-medium transition-colors"
          >
            {tc("cancel")}
          </button>
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-gray-200">
        <label className="block text-base font-medium text-gray-900 mb-2">
          {t("legalNoticeLabel")}
        </label>
        <textarea
          value={legalNotice}
          onChange={(e) => canEdit && setLegalNotice(e.target.value)}
          disabled={!canEdit}
          rows={4}
          placeholder={t("legalNoticePlaceholder")}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical disabled:bg-gray-50 disabled:text-gray-500"
        />
        {canEdit && hasNoticeChanges && (
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleSaveNotice}
              disabled={savingNotice}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {savingNotice ? tc("saving") : tc("save")}
            </button>
            <button
              onClick={() => setLegalNotice(savedLegalNotice)}
              className="px-5 py-3 text-gray-700 hover:text-gray-900 text-base font-medium transition-colors"
            >
              {tc("cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

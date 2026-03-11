"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState } from "react";

interface ConsentFormProps {
  onSuccess: () => void;
  policyVersion: string;
}

export default function ConsentForm({ onSuccess, policyVersion }: ConsentFormProps) {
  const t = useTranslations("Consent");
  const [dataProcessing, setDataProcessing] = useState(false);
  const [communication, setCommunication] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      // Always grant data_processing consent
      const dpRes = await fetch("/api/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentType: "data_processing", action: "granted" }),
      });

      if (!dpRes.ok) throw new Error();

      // Grant communication consent if checked
      if (communication) {
        const commRes = await fetch("/api/consents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consentType: "communication", action: "granted" }),
        });

        if (!commRes.ok) throw new Error();
      }

      onSuccess();
    } catch {
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t("title")}</h2>
        <p className="text-base text-gray-600 mb-6">{t("subtitle")}</p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dataProcessing}
              onChange={(e) => setDataProcessing(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-base text-gray-700">
              {t("dataProcessingLabel")}
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={communication}
              onChange={(e) => setCommunication(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-base text-gray-700">
              {t("communicationLabel")}
            </span>
          </label>

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link
              href="/privacy-policy"
              target="_blank"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              {t("privacyPolicyLink")}
            </Link>
            <span>&middot;</span>
            <span>{t("policyVersion", { version: policyVersion })}</span>
          </div>

          <button
            type="submit"
            disabled={!dataProcessing || submitting}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

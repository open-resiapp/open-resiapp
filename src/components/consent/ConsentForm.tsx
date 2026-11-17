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
      <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6 dark:bg-gray-800 dark:shadow-black/40">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">{t("title")}</h1>
        <p className="text-base text-gray-600 mb-6 dark:text-gray-300">{t("subtitle")}</p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer min-h-[44px] p-3 -mx-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
            <input
              type="checkbox"
              checked={dataProcessing}
              onChange={(e) => setDataProcessing(e.target.checked)}
              className="mt-0.5 w-6 h-6 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
            />
            <span className="text-base text-gray-700 dark:text-gray-200">
              {t("dataProcessingLabel")}
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer min-h-[44px] p-3 -mx-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
            <input
              type="checkbox"
              checked={communication}
              onChange={(e) => setCommunication(e.target.checked)}
              className="mt-0.5 w-6 h-6 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
            />
            <span className="text-base text-gray-700 dark:text-gray-200">
              {t("communicationLabel")}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2 text-base text-gray-600 dark:text-gray-300">
            <Link
              href="/privacy-policy"
              target="_blank"
              className="inline-flex items-center min-h-[44px] text-blue-700 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              {t("privacyPolicyLink")}
            </Link>
            <span>&middot;</span>
            <span>{t("policyVersion", { version: policyVersion })}</span>
          </div>

          <button
            type="submit"
            disabled={!dataProcessing || submitting}
            className="w-full min-h-[52px] py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";

interface ConsentStatus {
  action: "granted" | "withdrawn";
  createdAt: string;
  policyVersion: string;
}

export default function ConsentManagement() {
  const t = useTranslations("Consent");
  const [consents, setConsents] = useState<Record<string, ConsentStatus>>({});
  const [withdrawType, setWithdrawType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConsents = useCallback(async () => {
    try {
      const res = await fetch("/api/consents");
      if (!res.ok) return;
      const data = await res.json();
      setConsents(data.consents);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  async function handleAction(consentType: string, action: "granted" | "withdrawn") {
    const res = await fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consentType, action }),
    });

    if (!res.ok) return;

    setWithdrawType(null);

    if (consentType === "data_processing" && action === "withdrawn") {
      signOut({ callbackUrl: "/login" });
      return;
    }

    fetchConsents();
  }

  if (loading) return null;

  const types = [
    { key: "data_processing", label: t("dataProcessingTitle") },
    { key: "communication", label: t("communicationTitle") },
  ];

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t("managementTitle")}
        </h2>

        <div className="space-y-4">
          {types.map(({ key, label }) => {
            const consent = consents[key];
            const isGranted = consent?.action === "granted";

            return (
              <div
                key={key}
                className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-base font-medium text-gray-900">{label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${
                        isGranted
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {isGranted ? t("statusGranted") : t("statusNotGranted")}
                    </span>
                    {isGranted && consent.createdAt && (
                      <span className="text-sm text-gray-500">
                        {t("grantedOn", {
                          date: new Date(consent.createdAt).toLocaleDateString(),
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (isGranted) {
                      setWithdrawType(key);
                    } else {
                      handleAction(key, "granted");
                    }
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isGranted
                      ? "text-red-600 hover:bg-red-50 border border-red-200"
                      : "text-blue-600 hover:bg-blue-50 border border-blue-200"
                  }`}
                >
                  {isGranted ? t("withdraw") : t("grant")}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <Link
            href="/privacy-policy"
            target="_blank"
            className="text-sm text-blue-600 hover:text-blue-700 underline"
          >
            {t("viewPrivacyPolicy")}
          </Link>
        </div>
      </div>

      {/* Withdraw confirmation dialog */}
      {withdrawType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              {t("withdrawWarningTitle")}
            </h3>
            <p className="text-base text-gray-700 mb-6">
              {withdrawType === "data_processing"
                ? t("withdrawDataProcessingWarning")
                : t("withdrawCommunicationWarning")}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setWithdrawType(null)}
                className="px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t("withdrawCancel")}
              </button>
              <button
                onClick={() => handleAction(withdrawType, "withdrawn")}
                className="px-4 py-2 text-base font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                {t("withdrawConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

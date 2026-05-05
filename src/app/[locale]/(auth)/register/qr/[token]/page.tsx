"use client";

import { useTranslations, useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";

interface TokenInfo {
  valid: boolean;
  reason?: "not_found" | "disabled";
}

export default function RegisterQrPage() {
  const t = useTranslations("RegisterQr");
  const tRegister = useTranslations("Register");
  const locale = useLocale();
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [communicationConsent, setCommunicationConsent] = useState(false);

  useEffect(() => {
    fetch(`/api/register/qr/${token}`)
      .then(async (res) => {
        if (res.ok) {
          setInfo(await res.json());
        } else {
          const body = await res.json().catch(() => ({}));
          setInfo({ valid: false, reason: body.reason ?? "not_found" });
        }
      })
      .catch(() => setInfo({ valid: false, reason: "not_found" }))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/register/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        phone: formData.get("phone"),
        locale,
        consents: {
          data_processing: dataProcessingConsent,
          communication: communicationConsent,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || t("submitError"));
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <p className="text-base text-gray-500">{t("loading")}</p>
      </div>
    );
  }

  if (!info?.valid) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-4">&#x26A0;</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {t("invalidTitle")}
        </h1>
        <p className="text-base text-gray-600 mb-4">{t("invalidBody")}</p>
        <Link
          href="/login"
          className="inline-block mt-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
        >
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-4">&#x2709;</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {t("successTitle")}
        </h1>
        <p className="text-base text-gray-600 mb-4">{t("successBody")}</p>
        <Link
          href="/login"
          className="inline-block px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
        >
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <p className="text-gray-600 mt-2 text-base">{t("subtitle")}</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-base text-amber-900 mb-6">
        {t("approvalNotice")}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-base font-medium text-gray-700 mb-1">
            {t("nameLabel")}
          </label>
          <input
            name="name"
            required
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-base font-medium text-gray-700 mb-1">
            {t("emailLabel")}
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
            {t("passwordLabel")}
          </label>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-base font-medium text-gray-700 mb-1">
            {t("phoneLabel")}
          </label>
          <input
            name="phone"
            type="tel"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div className="border-t border-gray-200 pt-4 mt-2">
          <p className="text-base font-medium text-gray-700 mb-3">
            {tRegister("consentTitle")}
          </p>

          <label className="flex items-start gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={dataProcessingConsent}
              onChange={(e) => setDataProcessingConsent(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-base text-gray-700">
              {tRegister("dataProcessingConsent")}
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={communicationConsent}
              onChange={(e) => setCommunicationConsent(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-base text-gray-700">
              {tRegister("communicationConsent")}
            </span>
          </label>

          <Link
            href="/privacy-policy"
            target="_blank"
            className="text-sm text-blue-600 hover:text-blue-700 underline"
          >
            {tRegister("privacyPolicyLink")}
          </Link>

          {!dataProcessingConsent && (
            <p className="text-sm text-amber-600 mt-2">
              {tRegister("consentRequired")}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !dataProcessingConsent}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors"
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>
    </div>
  );
}

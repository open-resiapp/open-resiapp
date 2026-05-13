"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("Auth");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const verifyState = searchParams.get("verify");
  const ssoErrorKey = ((): string | null => {
    const code = searchParams.get("error");
    switch (code) {
      case "sso_invalid":
        return "ssoInvalid";
      case "sso_expired":
        return "ssoExpired";
      case "sso_replay":
        return "ssoReplay";
      case "sso_unsupported":
        return "ssoUnsupported";
      case "sso_blocked":
        return "ssoBlocked";
      default:
        return null;
    }
  })();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(t("invalidCredentials"));
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 dark:bg-gray-900 dark:shadow-black/40">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
        <p className="text-gray-600 mt-2 text-base dark:text-gray-300">{t("subtitle")}</p>
      </div>

      {verifyState === "ok" && (
        <div className="bg-green-50 text-green-700 border border-green-200 px-4 py-3 rounded-lg text-base mb-4 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800">
          {t("verifyOk")}
        </div>
      )}
      {verifyState === "expired" && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 px-4 py-3 rounded-lg text-base mb-4 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
          {t("verifyExpired")}
        </div>
      )}
      {verifyState === "not_found" && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 px-4 py-3 rounded-lg text-base mb-4 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
          {t("verifyInvalid")}
        </div>
      )}

      {ssoErrorKey && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 px-4 py-3 rounded-lg text-base mb-4 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
          {t(ssoErrorKey)}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-base font-medium text-gray-700 mb-2 dark:text-gray-200"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100 dark:placeholder-gray-500"
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-base font-medium text-gray-700 mb-2 dark:text-gray-200"
          >
            {t("passwordLabel")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors dark:disabled:bg-blue-800"
        >
          {loading ? t("submitting") : t("submit")}
        </button>
      </form>
    </div>
  );
}

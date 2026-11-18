"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

// Entry for owners who got a paper letter: type the short code printed under
// the QR instead of scanning it. Resolves to /claim/<token>.
export default function ClaimCodePage() {
  const t = useTranslations("Claim");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/claim/code/${encodeURIComponent(code.trim())}`);
      if (res.status === 429) {
        setError(t("codeRateLimited"));
        return;
      }
      if (!res.ok) {
        setError(t("codeInvalid"));
        return;
      }
      const { token } = (await res.json()) as { token: string };
      router.push(`/claim/${token}`);
    } catch {
      setError(t("codeInvalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 dark:bg-gray-900 dark:shadow-black/40">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("codeTitle")}</h1>
      <p className="text-gray-600 mt-2 mb-6 text-base dark:text-gray-300">{t("codeHint")}</p>
      {error && (
        <div role="alert" className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-base font-medium text-gray-700 dark:text-gray-200" htmlFor="claim-code">
          {t("codeLabel")}
        </label>
        <input
          id="claim-code"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-4 py-3 text-xl tracking-widest uppercase border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors dark:disabled:bg-blue-800"
        >
          {t("codeSubmit")}
        </button>
      </form>
    </div>
  );
}

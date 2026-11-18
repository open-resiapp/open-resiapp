"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

// Landing page of the claim-by-e-mail link. Deliberately does NOT sign in on
// load: mail scanners prefetch links, and the token is single-use — the owner
// presses the button, which POSTs the sign-in (auth.ts "claim-link").
export default function ClaimLinkPage() {
  const t = useTranslations("Claim");
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const linkToken = searchParams.get("t") ?? "";

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(!linkToken);

  async function activate() {
    setBusy(true);
    try {
      const result = await signIn("claim-link", { token: linkToken, redirect: false });
      if (!result || result.error) {
        setFailed(true);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center dark:bg-gray-900 dark:shadow-black/40">
        <h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">{t("linkInvalidTitle")}</h1>
        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">{t("linkInvalidBody")}</p>
        <div className="flex flex-col gap-3">
          <Link
            href={`/claim/${token}`}
            className="inline-block min-h-11 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            {t("linkRequestNew")}
          </Link>
          <Link
            href="/login"
            className="inline-block min-h-11 px-5 py-3 text-base font-medium text-blue-700 underline dark:text-blue-300"
          >
            {t("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 text-center dark:bg-gray-900 dark:shadow-black/40">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">{t("linkActivateTitle")}</h1>
      <p className="text-base text-gray-600 mb-6 dark:text-gray-300">{t("linkActivateBody")}</p>
      <button
        type="button"
        onClick={activate}
        disabled={busy}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors dark:disabled:bg-blue-800"
      >
        {busy ? t("submitting") : t("linkActivateButton")}
      </button>
    </div>
  );
}

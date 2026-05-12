"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

interface ClaimInfo {
  shellName: string;
  shellEmail: string | null;
  flatNumber: string | null;
  communityName: string | null;
  expiresAt: string;
}

interface InvalidInfo {
  error: "not_found" | "used" | "expired";
}

type LoadState =
  | { kind: "loading" }
  | { kind: "valid"; info: ClaimInfo }
  | { kind: "invalid"; reason: InvalidInfo["error"] };

export default function ClaimPage() {
  const t = useTranslations("Claim");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/claim/${token}`);
        if (cancelled) return;
        if (res.ok) {
          const info = (await res.json()) as ClaimInfo;
          setState({ kind: "valid", info });
          if (info.shellEmail) setEmail(info.shellEmail);
        } else if (res.status === 410) {
          const body = (await res.json()) as InvalidInfo;
          setState({ kind: "invalid", reason: body.error });
        } else {
          setState({ kind: "invalid", reason: "not_found" });
        }
      } catch {
        if (!cancelled) setState({ kind: "invalid", reason: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (password !== confirmPassword) {
      setFormError(t("passwordMismatch"));
      return;
    }
    if (password.length < 8) {
      setFormError(t("passwordTooShort"));
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/claim/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setFormError(t(`error.${body.error ?? "unknown"}` as never) || tCommon("saveFailed"));
      setSubmitting(false);
      return;
    }
    router.push(`/login?email=${encodeURIComponent(email)}`);
  }

  if (state.kind === "loading") {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center dark:bg-gray-900 dark:shadow-black/40">
        <p className="text-base text-gray-500 dark:text-gray-400">{t("loading")}</p>
      </div>
    );
  }

  if (state.kind === "invalid") {
    const reasonKey =
      state.reason === "expired"
        ? "expiredLink"
        : state.reason === "used"
          ? "usedLink"
          : "invalidLink";
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center dark:bg-gray-900 dark:shadow-black/40">
        <div className="text-5xl mb-4">&#x26A0;</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">
          {t(reasonKey)}
        </h1>
        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
          {t("invalidHint")}
        </p>
        <Link
          href="/login"
          className="inline-block mt-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
        >
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  const { info } = state;
  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 dark:bg-gray-900 dark:shadow-black/40">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
        <p className="text-gray-600 mt-2 text-base dark:text-gray-300">
          {t("greeting", { name: info.shellName })}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-base text-blue-800 mb-6 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-200">
        {info.communityName && (
          <p>
            <strong>{t("communityLabel")}:</strong> {info.communityName}
          </p>
        )}
        {info.flatNumber && (
          <p>
            <strong>{t("flatLabel")}:</strong> {info.flatNumber}
          </p>
        )}
      </div>

      {formError && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
            {t("emailLabel")}
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
            {t("passwordLabel")}
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
            {t("confirmPasswordLabel")}
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors dark:disabled:bg-blue-800"
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>

      <p className="text-sm text-gray-500 mt-6 text-center dark:text-gray-400">
        {t("expiresHint", {
          date: new Date(info.expiresAt).toLocaleDateString(),
        })}
      </p>
    </div>
  );
}

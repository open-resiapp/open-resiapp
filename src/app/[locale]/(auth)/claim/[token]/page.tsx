"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

interface ClaimInfo {
  shellName: string;
  shellEmail: string | null;
  paperOnly?: boolean;
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
  const locale = useLocale();
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [noEmailOpen, setNoEmailOpen] = useState(false);
  const [paperRequested, setPaperRequested] = useState(false);
  // "password" = set e-mail + password here; "link" = we e-mail a one-time
  // sign-in link, no password (POST mode "link").
  const [method, setMethod] = useState<"password" | "link">("password");
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

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
    if (res.status === 429) {
      setFormError(t("error.rateLimited"));
      setSubmitting(false);
      return;
    }
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

  async function handleLinkSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/claim/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "link", email, locale }),
      });
      if (res.status === 429) {
        setFormError(t("error.rateLimited"));
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const key = `error.${body.error ?? "unknown"}`;
        setFormError(t.has(key) ? t(key as never) : t("error.unknown"));
        return;
      }
      setLinkSentTo(email);
    } catch {
      setFormError(t("error.unknown"));
    } finally {
      setSubmitting(false);
    }
  }

  async function requestPaper() {
    const res = await fetch(`/api/claim/${token}/paper`, { method: "POST" });
    if (res.ok) setPaperRequested(true);
    else setFormError(tCommon("saveFailed"));
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

      <div role="group" aria-label={t("methodLabel")} className="grid grid-cols-1 gap-2 mb-6 sm:grid-cols-2">
        {(["password", "link"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            onClick={() => {
              setMethod(m);
              setFormError(null);
            }}
            className={
              method === m
                ? "min-h-11 py-3 px-4 text-base font-medium rounded-lg border-2 border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-400"
                : "min-h-11 py-3 px-4 text-base font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            }
          >
            {m === "password" ? t("methodPassword") : t("methodLink")}
          </button>
        ))}
      </div>

      {method === "link" ? (
        linkSentTo ? (
          <div role="status" className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-base text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-200">
            <p className="font-medium">{t("linkSentTitle")}</p>
            <p className="mt-1">{t("linkSentBody", { email: linkSentTo })}</p>
            <button
              type="button"
              onClick={() => setLinkSentTo(null)}
              className="mt-3 min-h-11 text-base font-medium text-blue-700 underline dark:text-blue-300"
            >
              {t("linkSendAgain")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleLinkSubmit} className="space-y-4">
            <p className="text-base text-gray-700 dark:text-gray-300">{t("linkHint")}</p>
            <div>
              <label htmlFor="claim-link-email" className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("emailLabel")}
              </label>
              <input
                id="claim-link-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:shadow-black/40 dark:text-gray-100"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-lg font-medium rounded-lg transition-colors dark:disabled:bg-blue-800"
            >
              {submitting ? t("submitting") : t("linkSubmit")}
            </button>
          </form>
        )
      ) : (
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
      )}

      {/* Dead end otherwise: no e-mail address means no e-mail link. */}
      <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
        {!noEmailOpen && !info.paperOnly ? (
          <button
            type="button"
            onClick={() => setNoEmailOpen(true)}
            className="w-full min-h-11 py-3 px-4 text-base font-medium text-blue-700 underline dark:text-blue-300"
          >
            {t("noEmailButton")}
          </button>
        ) : (
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-base text-gray-800 dark:bg-gray-800 dark:text-gray-100">
            <p>{t("noEmailBody")}</p>
            {paperRequested || info.paperOnly ? (
              <p role="status" className="mt-3 font-medium">
                {t("paperRequested")}
              </p>
            ) : (
              <button
                type="button"
                onClick={requestPaper}
                className="mt-3 w-full min-h-11 py-3 px-4 bg-gray-800 hover:bg-gray-900 text-white text-base font-medium rounded-lg dark:bg-gray-200 dark:text-gray-900"
              >
                {t("requestPaper")}
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-base text-gray-500 mt-6 text-center dark:text-gray-400">
        {t("expiresHint", {
          date: new Date(info.expiresAt).toLocaleDateString(),
        })}
      </p>
    </div>
  );
}

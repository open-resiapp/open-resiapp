import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requestUrlFromHeaders } from "@/lib/mcp/config";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import {
  AUTHORIZE_PARAMS,
  authorizeParamsToQuery,
  errorRedirectFor,
  readAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/mcp/oauth/authorize";
import { getUserAuthRow } from "@/lib/user-context";
import { decideAuthorization } from "./actions";

// OAuth consent screen (BYT-20261117-001 §2): NextAuth login → client name +
// logo, requested scopes in plain language, the data-leaves-the-instance
// warning, explicit Allow / Deny. 404 while the `mcp` module is disabled.

export const dynamic = "force-dynamic";

function hostOf(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Registrable-ish suffix ("claude.ai" for "api.claude.ai") — enough to compare app vs redirect. */
function siteOf(host: string): string {
  return host.split(".").slice(-2).join(".");
}

type ClientTrust =
  /** CIMD: metadata document fetched from the client's own HTTPS domain. */
  | { kind: "verified"; host: string }
  /** DCR / CIMD, nothing suspicious: neutral explanation, not an alarm. */
  | { kind: "registered"; host: string; local: boolean }
  /** A real red flag: the code would go to a site other than the app's own. */
  | { kind: "mismatch"; appHost: string; redirectHost: string };

/**
 * How much the consent screen can say about the client. Dynamic client
 * registration (RFC 7591) is how Claude Desktop, ChatGPT and most MCP hosts
 * connect, so "unverified" in red for every one of them taught users to
 * ignore the colour. Red stays for a concrete problem: the redirect goes to
 * a different site than the app's declared home (client_id URL for CIMD,
 * client_uri for DCR). Loopback redirects are how desktop apps receive the
 * code and are not a mismatch.
 */
function clientTrust(
  client: { clientId: string; source: "cimd" | "dcr"; clientUri: string | null },
  redirectUri: string
): ClientTrust {
  const redirectHost = hostOf(redirectUri);
  const local = LOOPBACK.has(redirectHost);
  const appHost = client.source === "cimd" ? hostOf(client.clientId) : hostOf(client.clientUri);
  if (appHost && redirectHost && !local && siteOf(appHost) !== siteOf(redirectHost)) {
    return { kind: "mismatch", appHost, redirectHost };
  }
  if (client.source === "cimd" && appHost) return { kind: "verified", host: appHost };
  return { kind: "registered", host: redirectHost || appHost, local };
}

export default async function OAuthAuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isMcpEnabled())) notFound();
  const { locale } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const key of AUTHORIZE_PARAMS) {
    const v = sp[key];
    if (typeof v === "string") qs.set(key, v);
  }
  const authParams = readAuthorizeParams(qs);
  const t = await getTranslations("Mcp.consent");
  const tScopes = await getTranslations("Mcp.scopes");

  // Same origin fallback as /api/oauth/authorize (req.url) when no public
  // URL is configured — else resource validation fails as invalid_target.
  const requestUrl = await requestUrlFromHeaders();
  const v = await validateAuthorizeRequest(authParams, requestUrl);
  if (v.kind === "fatal") {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8 dark:bg-gray-900 dark:shadow-black/40">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t("errorTitle")}</h1>
        <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
          {v.reason === "invalid_client" ? t("errorInvalidClient") : t("errorInvalidRedirect")}
        </p>
      </div>
    );
  }
  if (v.kind === "redirect_error") redirect(errorRedirectFor(v, requestUrl));

  const session = await auth();
  if (!session) {
    const back = `/${locale}/oauth/authorize?${authorizeParamsToQuery(authParams)}`;
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(back)}`);
  }
  const user = await getUserAuthRow(session.user.id);
  const active = user?.status === "active";
  const trust = clientTrust(v.client, v.redirectUri);

  const hidden = AUTHORIZE_PARAMS.map((key) =>
    authParams[key] !== undefined ? (
      <input key={key} type="hidden" name={key} value={authParams[key]} />
    ) : null
  );

  return (
    <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8 dark:bg-gray-900 dark:shadow-black/40">
      <div className="flex items-start gap-3">
        {v.client.logoUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.client.logoUri}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 shrink-0 rounded-xl object-contain"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold leading-tight text-gray-900 break-words dark:text-gray-100">
            {t("title", { client: v.client.name })}
          </h1>
          {trust.kind === "verified" && (
            <p className="mt-1 text-base break-words text-green-700 dark:text-green-400">
              {t("verifiedHost", { host: trust.host })}
            </p>
          )}
        </div>
      </div>

      {trust.kind === "registered" && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-base text-gray-800 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <p className="font-medium break-words">
            {trust.local
              ? t("registeredLocal")
              : t("registeredHost", { host: trust.host })}
          </p>
          <p className="mt-1 text-gray-700 dark:text-gray-300">{t("registeredExplain")}</p>
        </div>
      )}

      {trust.kind === "mismatch" && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          <p className="font-semibold break-words">
            {t("redirectMismatch", { app: trust.appHost, host: trust.redirectHost })}
          </p>
          <p className="mt-1">{t("redirectMismatchExplain")}</p>
        </div>
      )}

      <p className="mt-5 text-base text-gray-700 dark:text-gray-300">
        {t("intro", { user: user?.name ?? session.user.email ?? "" })}
      </p>

      <div className="mt-5 rounded-xl bg-gray-50 p-4 dark:bg-gray-800/60">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t("scopesHeading")}</h2>
        <ul className="mt-3 space-y-3">
          {v.scopes.map((s) => (
            <li key={s} className="flex gap-3 text-base text-gray-800 dark:text-gray-200">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>{tScopes(s.replace(":", "_"))}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t("roleNote")}</p>
      </div>

      <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="mt-0.5 h-5 w-5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        <p>{t("dataWarning", { client: v.client.name })}</p>
      </div>

      {!active && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-base text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          {t("inactiveUser")}
        </div>
      )}

      <form action={decideAuthorization} className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <input type="hidden" name="locale" value={locale} />
        {hidden}
        {active && (
          <button
            type="submit"
            name="decision"
            value="allow"
            className="min-h-12 flex-1 rounded-xl bg-blue-600 px-5 py-3 text-base font-semibold text-white hover:bg-blue-700"
          >
            {t("allow")}
          </button>
        )}
        <button
          type="submit"
          name="decision"
          value="deny"
          className="min-h-12 flex-1 rounded-xl border border-gray-300 px-5 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          {t("deny")}
        </button>
      </form>

      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">{t("revokeHint")}</p>
    </div>
  );
}

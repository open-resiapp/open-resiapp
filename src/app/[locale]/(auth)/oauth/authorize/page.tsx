import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
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

function clientHost(clientId: string, redirectUri: string): string {
  try {
    return new URL(clientId).hostname;
  } catch {
    try {
      return new URL(redirectUri).hostname;
    } catch {
      return "";
    }
  }
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

  const v = await validateAuthorizeRequest(authParams);
  if (v.kind === "fatal") {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8 dark:bg-gray-900 dark:shadow-black/40">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("errorTitle")}</h1>
        <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
          {v.reason === "invalid_client" ? t("errorInvalidClient") : t("errorInvalidRedirect")}
        </p>
      </div>
    );
  }
  if (v.kind === "redirect_error") redirect(errorRedirectFor(v));

  const session = await auth();
  if (!session) {
    const back = `/${locale}/oauth/authorize?${authorizeParamsToQuery(authParams)}`;
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(back)}`);
  }
  const user = await getUserAuthRow(session.user.id);
  const active = user?.status === "active";
  const host = clientHost(v.client.clientId, v.redirectUri);

  const hidden = AUTHORIZE_PARAMS.map((key) =>
    authParams[key] !== undefined ? (
      <input key={key} type="hidden" name={key} value={authParams[key]} />
    ) : null
  );

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 dark:bg-gray-900 dark:shadow-black/40">
      <div className="flex items-center gap-4">
        {v.client.logoUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.client.logoUri}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded-lg object-contain"
          />
        )}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("title", { client: v.client.name })}
          </h1>
          {host && (
            <p className="text-base text-gray-600 dark:text-gray-400">
              {v.client.source === "cimd" ? t("verifiedHost", { host }) : t("unverifiedHost", { host })}
            </p>
          )}
        </div>
      </div>

      <p className="mt-6 text-base text-gray-700 dark:text-gray-300">
        {t("intro", { user: user?.name ?? session.user.email ?? "" })}
      </p>

      <h2 className="mt-6 text-lg font-semibold text-gray-900 dark:text-gray-100">{t("scopesHeading")}</h2>
      <ul className="mt-2 space-y-2">
        {v.scopes.map((s) => (
          <li key={s} className="flex gap-2 text-base text-gray-800 dark:text-gray-200">
            <span aria-hidden="true">•</span>
            <span>{tScopes(s.replace(":", "_"))}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-base text-gray-600 dark:text-gray-400">{t("roleNote")}</p>

      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        {t("dataWarning", { client: v.client.name })}
      </div>

      {!active && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-base text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          {t("inactiveUser")}
        </div>
      )}

      <form action={decideAuthorization} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="locale" value={locale} />
        {hidden}
        {active && (
          <button
            type="submit"
            name="decision"
            value="allow"
            className="flex-1 rounded-lg bg-blue-600 px-5 py-3 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("allow")}
          </button>
        )}
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded-lg border border-gray-300 px-5 py-3 text-base font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          {t("deny")}
        </button>
      </form>

      <p className="mt-6 text-base text-gray-500 dark:text-gray-400">{t("revokeHint")}</p>
    </div>
  );
}

"use server";

import { notFound, redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { requestUrlFromHeaders } from "@/lib/mcp/config";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import {
  authorizeParamsToQuery,
  buildClientRedirect,
  errorRedirectFor,
  readAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/mcp/oauth/authorize";
import { createAuthorizationCode } from "@/lib/mcp/oauth/tokens";
import { assertWritable } from "@/lib/readonly";
import { getUserAuthRow } from "@/lib/user-context";

// Consent decision (BYT-20261117-001 §2). Re-validates the whole request —
// the hidden form fields are user-controlled — then issues a single-use
// code (Allow) or `access_denied` (Deny). Pending / rejected users can
// never grant.

function safeLocale(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return (routing.locales as readonly string[]).includes(s) ? s : routing.defaultLocale;
}

export async function decideAuthorization(formData: FormData): Promise<void> {
  assertWritable();
  if (!(await isMcpEnabled())) notFound();

  const locale = safeLocale(formData.get("locale"));
  const params = readAuthorizeParams(formData);
  const consentPath = `/${locale}/oauth/authorize?${authorizeParamsToQuery(params)}`;

  // Same origin fallback as /api/oauth/authorize (req.url) when no public
  // URL is configured — else resource validation fails as invalid_target.
  const requestUrl = await requestUrlFromHeaders();
  const v = await validateAuthorizeRequest(params, requestUrl);
  if (v.kind === "fatal") redirect(consentPath);
  if (v.kind === "redirect_error") redirect(errorRedirectFor(v, requestUrl));

  const session = await auth();
  if (!session) {
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(consentPath)}`);
  }

  if (formData.get("decision") !== "allow") {
    redirect(buildClientRedirect(v.redirectUri, { error: "access_denied", state: v.state }, requestUrl));
  }

  const user = await getUserAuthRow(session.user.id);
  if (user?.status !== "active") {
    redirect(
      buildClientRedirect(v.redirectUri, {
        error: "access_denied",
        error_description: "account not active",
        state: v.state,
      }, requestUrl)
    );
  }

  const code = await createAuthorizationCode({
    client: v.client,
    userId: user.id,
    codeChallenge: v.codeChallenge,
    redirectUri: v.redirectUri,
    resource: v.resource,
    scopes: v.scopes,
  });
  redirect(buildClientRedirect(v.redirectUri, { code, state: v.state }, requestUrl));
}

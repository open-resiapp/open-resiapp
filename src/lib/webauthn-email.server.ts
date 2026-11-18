import "server-only";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { EMAIL_FROM, getTransporter } from "@/lib/email";
import { routing } from "@/i18n/routing";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { timeZoneForCountry } from "@/lib/time-zone";
import { getPublicAppUrl, signPasskeyActivation } from "@/lib/webauthn.server";

// BYT-20261117-002 Phase 6: passkey e-mails (strings: messages → Email.passkey).
//   - activation link: a newly registered passkey works only after this
//     single-use link is clicked (src/lib/webauthn.server.ts activatePasskey);
//   - "a new passkey was added to your account" notice, sent once a passkey
//     has been activated (by its own link or by the first-vote e-mail link).
// Times are formatted in the community's time zone, not the server's.

type EmailLocale = (typeof routing.locales)[number];
const BCP47: Record<EmailLocale, string> = { sk: "sk-SK", en: "en-GB", cs: "cs-CZ" };

function resolveLocale(input?: string | null): EmailLocale {
  return input && (routing.locales as readonly string[]).includes(input)
    ? (input as EmailLocale)
    : (routing.defaultLocale as EmailLocale);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "j•••••@example.com" — what the UI may show of the address a link went to. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

async function communityTimeZone(): Promise<string> {
  const root = await getCommunityRoot();
  return timeZoneForCountry(root?.country);
}

async function recipient(userId: string) {
  const [u] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.email ? { email: u.email, name: u.name } : null;
}

export type ActivationEmailResult =
  | { ok: true; /** masked */ sentTo: string; expiresAt: Date }
  | { ok: false; code: "NO_EMAIL" | "EMAIL_UNAVAILABLE" };

/**
 * E-mail the single-use activation link for a pending passkey.
 * Throws ConfirmationUnavailableError (→ 503) when the public URL or the
 * token secret is not configured.
 */
export async function sendPasskeyActivationEmail(params: {
  request: NextRequest;
  userId: string;
  /** createdAt: when the passkey was registered (shown in the e-mail). */
  credential: { id: string; credentialId: string; deviceLabel: string | null; createdAt?: Date };
  locale?: string | null;
}): Promise<ActivationEmailResult> {
  const to = await recipient(params.userId);
  if (!to) return { ok: false, code: "NO_EMAIL" };
  const transporter = getTransporter();
  if (!transporter) return { ok: false, code: "EMAIL_UNAVAILABLE" };

  const locale = resolveLocale(params.locale);
  const { token, expiresAt } = signPasskeyActivation(params.userId, params.credential);
  const url = `${getPublicAppUrl(params.request)}/${locale}/passkey-activate?t=${encodeURIComponent(token)}`;

  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.passkey" });
  const timeZone = await communityTimeZone();
  const expires = expiresAt.toLocaleTimeString(BCP47[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const device = params.credential.deviceLabel || t("unnamedDevice");
  // Registration time + browser let the owner spot a passkey they did not
  // add. Rendered once the catalog has the key (added separately).
  const registeredAt = (params.credential.createdAt ?? new Date()).toLocaleString(BCP47[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const registeredLine = t.has("activationRegisteredAt")
    ? `<p style="color: #374151;">${esc(t("activationRegisteredAt", { time: registeredAt, device }))}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${esc(t("activationHeading"))}</h2>
      <p>${esc(tCommon("greeting", { name: to.name }))}</p>
      <p>${esc(t("activationIntro", { device }))}</p>
      ${registeredLine}
      <div style="margin: 24px 0; text-align: center;">
        <a href="${esc(url)}"
           style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${esc(t("activationButton"))}
        </a>
      </div>
      <p style="color: #374151;">${esc(t("activationExpiry", { time: expires }))}</p>
      <p style="color: #6b7280; font-size: 14px;">${esc(t("activationNotYou"))}</p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: to.email,
      subject: t("activationSubject"),
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send passkey activation link:", error);
    return { ok: false, code: "EMAIL_UNAVAILABLE" };
  }
  return { ok: true, sentTo: maskEmail(to.email), expiresAt };
}

/** Security notice after a passkey was activated. Best effort, never throws. */
export async function sendPasskeyAddedNotice(params: {
  userId: string;
  deviceLabel: string | null;
  activatedAt: Date;
  locale?: string | null;
}): Promise<void> {
  try {
    const to = await recipient(params.userId);
    const transporter = getTransporter();
    if (!to || !transporter) return;
    const locale = resolveLocale(params.locale);
    const tCommon = await getTranslations({ locale, namespace: "Email.common" });
    const t = await getTranslations({ locale, namespace: "Email.passkey" });
    const timeZone = await communityTimeZone();
    const when = params.activatedAt.toLocaleString(BCP47[locale], {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    const device = params.deviceLabel || t("unnamedDevice");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1d4ed8;">${esc(t("addedHeading"))}</h2>
        <p>${esc(tCommon("greeting", { name: to.name }))}</p>
        <p>${esc(t("addedIntro", { device, date: when }))}</p>
        <p style="color: #374151;">${esc(t("addedNotYou"))}</p>
      </div>
    `;
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: to.email,
      subject: t("addedSubject"),
      html,
    });
  } catch (error) {
    console.error("[email] Failed to send passkey added notice:", error);
  }
}

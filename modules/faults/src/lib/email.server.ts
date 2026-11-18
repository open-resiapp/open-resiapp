import "server-only";

import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { EMAIL_FROM, getTransporter } from "@/lib/email";

// Fault e-mails (BYT-20261118-004). Module-local helper per CLAUDE.md: copy
// comes from `Faults.email.*` via getTranslations({ locale }), locale param
// optional (default routing.defaultLocale — there is no users.locale yet).

function resolveLocale(input?: string): string {
  return input && (routing.locales as readonly string[]).includes(input)
    ? input
    : routing.defaultLocale;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function button(href: string, label: string): string {
  return `<div style="margin: 24px 0; text-align: center;">
    <a href="${esc(href)}" style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">${esc(label)}</a>
  </div>`;
}

export async function sendFaultStatusChanged(params: {
  recipientEmail: string;
  recipientName: string;
  faultTitle: string;
  /** Status slug — rendered via Faults.status.<slug>. */
  status: string;
  publicMessage: string | null;
  faultUrl: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[faults/email] SMTP not configured — skipping status e-mail");
    return false;
  }
  const locale = resolveLocale(params.locale);
  const t = await getTranslations({ locale, namespace: "Faults" });
  const statusLabel = t(`status.${params.status}` as "status.new");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; font-size: 16px;">
      <h2 style="color: #1d4ed8;">${esc(t("email.statusChanged.heading"))}</h2>
      <p>${esc(t("email.greeting", { name: params.recipientName }))}</p>
      <p>${esc(t("email.statusChanged.intro", { title: params.faultTitle, status: statusLabel }))}</p>
      ${
        params.publicMessage
          ? `<p style="padding: 12px; background: #f3f4f6; border-radius: 8px;">${esc(params.publicMessage)}</p>`
          : ""
      }
      ${button(params.faultUrl, t("email.statusChanged.button"))}
      <p style="color: #6b7280; font-size: 14px;">${esc(t("email.statusChanged.hint"))}</p>
    </div>`;
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: params.recipientEmail,
      subject: t("email.statusChanged.subject", { title: params.faultTitle, status: statusLabel }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[faults/email] status e-mail failed:", error);
    return false;
  }
}

export async function sendFaultStaleDigest(params: {
  recipientEmail: string;
  recipientName: string;
  faults: { title: string; days: number; url: string }[];
  listUrl: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[faults/email] SMTP not configured — skipping stale digest");
    return false;
  }
  const locale = resolveLocale(params.locale);
  const t = await getTranslations({ locale, namespace: "Faults" });
  const items = params.faults
    .map(
      (f) =>
        `<li style="margin-bottom: 8px;"><a href="${esc(f.url)}">${esc(f.title)}</a> — ${esc(
          t("email.staleDigest.openDays", { days: f.days })
        )}</li>`
    )
    .join("");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; font-size: 16px;">
      <h2 style="color: #1d4ed8;">${esc(t("email.staleDigest.heading"))}</h2>
      <p>${esc(t("email.greeting", { name: params.recipientName }))}</p>
      <p>${esc(t("email.staleDigest.intro", { count: params.faults.length }))}</p>
      <ul>${items}</ul>
      ${button(params.listUrl, t("email.staleDigest.button"))}
    </div>`;
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: params.recipientEmail,
      subject: t("email.staleDigest.subject", { count: params.faults.length }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[faults/email] stale digest failed:", error);
    return false;
  }
}

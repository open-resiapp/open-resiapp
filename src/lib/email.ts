import nodemailer from "nodemailer";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getBranding, brandingLogoAbsoluteUrl } from "@/lib/branding.server";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM || "noreply@mojabytovka.sk";

type EmailLocale = (typeof routing.locales)[number];

function resolveLocale(input?: string): EmailLocale {
  if (input && (routing.locales as readonly string[]).includes(input)) {
    return input as EmailLocale;
  }
  return routing.defaultLocale as EmailLocale;
}

const BCP47_BY_LOCALE: Record<EmailLocale, string> = {
  sk: "sk-SK",
  en: "en-GB",
  cs: "cs-CZ",
};

function bcp47(locale: EmailLocale): string {
  return BCP47_BY_LOCALE[locale];
}

// Exported for use by bundled modules (voting, etc.) until the
// SDK delta on RES-20260428-002 ships `sdk.email.send`. After that
// modules talk to email exclusively through the SDK and these names
// become private again.
export function getTransporter() {
  if (!smtpHost) {
    return null;
  }

  const auth = smtpUser && smtpPass
    ? { user: smtpUser, pass: smtpPass }
    : undefined;

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth,
  });
}

export const EMAIL_FROM = emailFrom;

/**
 * BYT-20260512-008: optional white-label logo header for transactional emails.
 * Returns an <img> block (absolute URL — mail clients fetch off-session) when
 * the instance has a logo, else "". Never throws into the mail path.
 */
async function brandingEmailHeader(): Promise<string> {
  try {
    const branding = await getBranding();
    if (!branding) return "";
    const url = brandingLogoAbsoluteUrl(branding.branding.v);
    return `<div style="text-align: center; margin-bottom: 24px;"><img src="${url}" alt="" style="max-height: 48px; max-width: 220px; height: auto;" /></div>`;
  } catch {
    return "";
  }
}

export async function sendPasswordReset(params: {
  recipientEmail: string;
  userName: string;
  resetUrl: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping password reset email"
    );
    return false;
  }

  const logoHeader = await brandingEmailHeader();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${logoHeader}
      <h2 style="color: #1d4ed8;">Obnovenie hesla</h2>
      <p>Vážený/á <strong>${params.userName}</strong>,</p>
      <p>Dostali sme žiadosť o obnovenie vášho hesla. Kliknutím na odkaz nižšie si nastavíte nové heslo:</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.resetUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Obnoviť heslo
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        Ak ste túto žiadosť nepodali, tento email môžete ignorovať. Odkaz je platný 1 hodinu.
      </p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        Ak odkaz nefunguje, skopírujte túto adresu do prehliadača:<br/>
        <span style="word-break: break-all;">${params.resetUrl}</span>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: "Obnovenie hesla — OpenResiApp",
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send password reset email:", error);
    return false;
  }
}

export async function sendPairingInvitation(params: {
  recipientEmail: string;
  buildingName: string;
  buildingUrl: string;
  partA: string;
  expiryHours: number;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping pairing invitation email"
    );
    console.log("[email] Pairing token for", params.recipientEmail, ":", params.partA);
    return false;
  }

  const logoHeader = await brandingEmailHeader();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${logoHeader}
      <h2 style="color: #1d4ed8;">Pozvánka na prepojenie</h2>
      <p>Boli ste pozvaní na prepojenie s bytovým domom <strong>${params.buildingName}</strong>.</p>

      <p>Na dokončenie párovania použite nasledujúci kód:</p>

      <div style="margin: 24px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px; text-align: center;">
        <code style="font-size: 14px; word-break: break-all; color: #1f2937;">${params.partA}</code>
      </div>

      <p><strong>URL inštancie:</strong><br/>
        <a href="${params.buildingUrl}" style="color: #2563eb;">${params.buildingUrl}</a>
      </p>

      <p style="color: #dc2626; font-weight: bold;">
        Kód je platný ${params.expiryHours} hodinu.
      </p>

      <p style="color: #6b7280; font-size: 14px;">
        Zadajte tento kód a URL inštancie v administrácii vašej aplikácie na dokončenie prepojenia.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: `Pozvánka na prepojenie — ${params.buildingName}`,
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send pairing invitation:", error);
    return false;
  }
}

export async function sendCommunityResponseNotification(params: {
  recipientEmail: string;
  recipientName: string;
  responderName: string;
  postTitle: string;
  postUrl: string;
  responseContent: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping community response notification"
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.response" });

  const safePreview =
    params.responseContent.length > 240
      ? params.responseContent.slice(0, 240) + "…"
      : params.responseContent;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro", { responder: params.responderName })}</p>
      <p style="font-weight: bold; color: #111827;">${params.postTitle}</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background-color: #f3f4f6; border-left: 4px solid #2563eb; border-radius: 4px; color: #374151;">
        ${safePreview.replace(/\n/g, "<br/>")}
      </blockquote>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${tCommon("viewPostButton")}
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        ${tCommon("replyHint")}
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { postTitle: params.postTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send community response notification:", error);
    return false;
  }
}

export async function sendPostExpiryReminder(params: {
  recipientEmail: string;
  recipientName: string;
  postTitle: string;
  postUrl: string;
  expiresAt: Date;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping post expiry reminder"
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.expiryReminder" });

  const expiresLabel = params.expiresAt.toLocaleDateString(bcp47(locale));

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro", { postTitle: params.postTitle, expiresAt: expiresLabel })}</p>
      <p>${t("actionHint")}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${tCommon("managePostButton")}
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { postTitle: params.postTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send post expiry reminder:", error);
    return false;
  }
}

export async function sendEventReminder(params: {
  recipientEmail: string;
  recipientName: string;
  eventTitle: string;
  eventDate: Date;
  eventLocation: string | null;
  postUrl: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping event reminder"
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.eventReminder" });

  const dateLabel = params.eventDate.toLocaleString(bcp47(locale), {
    dateStyle: "full",
    timeStyle: "short",
  });

  const locationBlock = params.eventLocation
    ? `<p style="margin: 4px 0;"><strong>${t("whereLabel")}:</strong> ${params.eventLocation}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro")}</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
        <p style="margin: 4px 0; font-weight: bold; font-size: 18px; color: #111827;">${params.eventTitle}</p>
        <p style="margin: 4px 0;"><strong>${t("whenLabel")}:</strong> ${dateLabel}</p>
        ${locationBlock}
      </div>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${tCommon("eventDetailButton")}
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { eventTitle: params.eventTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send event reminder:", error);
    return false;
  }
}

export async function sendQrRegistrationVerify(params: {
  recipientEmail: string;
  recipientName: string;
  verifyUrl: string;
  expiryHours: number;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping QR registration verify email"
    );
    console.log(
      "[email] Verify URL for",
      params.recipientEmail,
      ":",
      params.verifyUrl
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({
    locale,
    namespace: "Email.qrRegistrationVerify",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro")}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.verifyUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${t("button")}
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        ${t("expiryNote", { hours: params.expiryHours })}
      </p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        ${t("fallback")}<br/>
        <span style="word-break: break-all;">${params.verifyUrl}</span>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject"),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send QR registration verify email:", error);
    return false;
  }
}

export async function sendQrRegistrationPendingAdmin(params: {
  recipientEmail: string;
  recipientName: string;
  pendingName: string;
  pendingEmail: string;
  queueUrl: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping QR registration admin notification"
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({
    locale,
    namespace: "Email.qrRegistrationPendingAdmin",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro")}</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
        <p style="margin: 4px 0;"><strong>${t("nameLabel")}:</strong> ${params.pendingName}</p>
        <p style="margin: 4px 0;"><strong>${t("emailLabel")}:</strong> ${params.pendingEmail}</p>
      </div>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.queueUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${t("button")}
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { name: params.pendingName }),
      html,
    });
    return true;
  } catch (error) {
    console.error(
      "[email] Failed to send QR registration admin notification:",
      error
    );
    return false;
  }
}

// sendVoteConfirmation moved to modules/voting/src/email/ under
// RES-20260505-001. Importers now read it from the voting module.

export async function sendClaimShellInvitation(params: {
  recipientEmail: string;
  recipientName: string;
  claimUrl: string;
  expiryDays: number;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping shell-claim invitation"
    );
    console.log(
      "[email] Claim URL for",
      params.recipientEmail,
      ":",
      params.claimUrl
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.claimShell" });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading")}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro")}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.claimUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${t("button")}
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        ${t("expiryNote", { days: params.expiryDays })}
      </p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        ${t("fallback")}<br/>
        <span style="word-break: break-all;">${params.claimUrl}</span>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject"),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send claim invitation:", error);
    return false;
  }
}

/**
 * Accounting (BYT-20260512-002): notifies an owner that the annual
 * settlement for their unit is published and downloadable in the app.
 * A NOTIFICATION, not the statutory delivery of the document — the
 * electronic-delivery consent flow (spec §vyúčtovanie delivery) governs
 * the statutory channel separately.
 */
export async function sendSettlementPublishedNotification(params: {
  recipientEmail: string;
  recipientName: string;
  buildingName: string;
  year: number;
  kartaUrl: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping settlement notification"
    );
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({
    locale,
    namespace: "Email.settlementPublished",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading", { year: params.year })}</h2>
      <p>${tCommon("greeting", { name: params.recipientName })}</p>
      <p>${t("intro", { building: params.buildingName, year: params.year })}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.kartaUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${t("button")}
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">${t("hint")}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { year: params.year }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send settlement notification:", error);
    return false;
  }
}

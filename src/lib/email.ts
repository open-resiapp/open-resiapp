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

/**
 * BYT-20261118-006: reminder before a reading round's deadline (odpočty
 * meračov / osoby v byte). Strings from `ReadingRounds.email` in
 * messages/{locale}.json. Returns false when nothing was sent.
 */
export async function sendReadingReminder(params: {
  recipientEmail: string;
  recipientName: string;
  buildingName: string;
  year: number;
  deadline: Date;
  url: string;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured — skipping reading reminder");
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "ReadingRounds.email" });
  const deadline = params.deadline.toLocaleDateString(bcp47(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const building = escapeHtml(params.buildingName);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${t("heading", { year: params.year })}</h2>
      <p>${tCommon("greeting", { name: escapeHtml(params.recipientName) })}</p>
      <p>${t("intro", { building, year: params.year, deadline })}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.url}"
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
      subject: t("subject", { year: params.year, deadline }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send reading reminder:", error);
    return false;
  }
}

/**
 * BYT-20261118-005 Phase D: the board sends one document to an owner. The
 * document is attached when it fits the size cap, otherwise the e-mail
 * carries a login-gated link (`linkUrl`, proxied + access-logged download).
 * Caller has already checked the recipient may see the document — this
 * function only renders and sends. Returns false when nothing was sent.
 */
export async function sendDocumentToOwner(params: {
  recipientEmail: string;
  recipientName: string;
  documentName: string;
  buildingName?: string | null;
  senderName?: string | null;
  message?: string | null;
  attachment?: { filename: string; content: Buffer; contentType: string } | null;
  linkUrl?: string | null;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured — skipping document send");
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.documentSent" });
  const header = await brandingEmailHeader();

  const doc = escapeHtml(params.documentName);
  const building = escapeHtml(params.buildingName || "");
  const sender = escapeHtml(params.senderName || "");
  const message = params.message?.trim()
    ? `<blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 4px solid #2563eb; background: #f3f4f6; white-space: pre-wrap;">${escapeHtml(params.message.trim())}</blockquote>`
    : "";
  const body = params.attachment
    ? `<p>${t("attachedHint", { document: doc })}</p>`
    : params.linkUrl
      ? `<div style="margin: 24px 0; text-align: center;">
           <a href="${escapeHtml(params.linkUrl)}"
              style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
             ${t("button")}
           </a>
         </div>
         <p style="color: #6b7280; font-size: 14px;">${t("linkHint")}</p>`
      : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${header}
      <h2 style="color: #1d4ed8;">${t("heading", { document: doc })}</h2>
      <p>${tCommon("greeting", { name: escapeHtml(params.recipientName) })}</p>
      <p>${t("intro", { document: doc, building, sender })}</p>
      ${message}
      ${body}
      <p style="color: #6b7280; font-size: 14px;">${t("footer")}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { document: params.documentName }),
      html,
      attachments: params.attachment
        ? [
            {
              filename: params.attachment.filename,
              content: params.attachment.content,
              contentType: params.attachment.contentType,
            },
          ]
        : undefined,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send document:", error);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * BYT-20261117-001 §6: ballot confirmation for a ballot an owner requested
 * through an AI app (MCP `request_ballot_confirmation`). Lists every item +
 * choice + the short ballot hash; the link opens the confirm page, which
 * requires login as the same owner and an explicit "confirm" click. The
 * vote is NOT cast by this email. Statutory content — legal-copy sign-off
 * pending (spec AC).
 *
 * Returns false when the mail could not be sent (the caller kills the
 * request: there is nothing for the owner to click). Without SMTP in
 * non-production the link is logged and treated as delivered so the flow
 * stays testable locally.
 */
export async function sendBallotConfirmation(params: {
  recipientEmail: string;
  recipientName: string;
  votingTitle: string;
  unitName: string;
  clientName: string;
  items: { n: number; title: string; choice: "za" | "proti" | "zdrzal_sa" | null }[];
  shortHash: string;
  confirmUrl: string;
  expiryMinutes: number;
  locale?: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[email] SMTP not configured — ballot confirmation link (dev only):", params.confirmUrl);
      return true;
    }
    console.warn("[email] SMTP not configured — cannot send ballot confirmation");
    return false;
  }

  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.ballotConfirm" });

  const choiceLabel = (c: "za" | "proti" | "zdrzal_sa" | null) =>
    c === "za"
      ? t("choiceFor")
      : c === "proti"
        ? t("choiceAgainst")
        : c === "zdrzal_sa"
          ? t("choiceAbstain")
          : t("choiceUnmarked");

  const rows = params.items
    .map(
      (it) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; color: #6b7280;">${it.n}.</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top;">${escapeHtml(it.title)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-weight: bold; white-space: nowrap;">${escapeHtml(choiceLabel(it.choice))}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${await brandingEmailHeader()}
      <h2 style="color: #1d4ed8;">${escapeHtml(t("heading"))}</h2>
      <p>${escapeHtml(tCommon("greeting", { name: params.recipientName }))}</p>
      <p>${escapeHtml(
        t("intro", {
          voting: params.votingTitle,
          unit: params.unitName,
          client: params.clientName,
        })
      )}</p>
      <p style="font-weight: bold;">${escapeHtml(t("notCastYet"))}</p>
      <h3 style="margin-top: 24px;">${escapeHtml(t("itemsHeading"))}</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #d1d5db;">#</th>
            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #d1d5db;">${escapeHtml(t("itemColumn"))}</th>
            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #d1d5db;">${escapeHtml(t("choiceColumn"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top: 16px;">${escapeHtml(t("hashLabel"))} <code style="font-size: 15px;">${escapeHtml(params.shortHash)}</code></p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${escapeHtml(params.confirmUrl)}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${escapeHtml(t("button"))}
        </a>
      </div>
      <p>${escapeHtml(t("loginNote"))}</p>
      <p style="color: #6b7280; font-size: 14px;">${escapeHtml(t("expiryNote", { minutes: params.expiryMinutes }))}</p>
      <p style="color: #6b7280; font-size: 14px;">${escapeHtml(t("ignoreNote"))}</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        ${escapeHtml(t("fallback"))}<br/>
        <span style="word-break: break-all;">${escapeHtml(params.confirmUrl)}</span>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t("subject", { voting: params.votingTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send ballot confirmation:", error);
    return false;
  }
}

// ── Owners' meeting (BYT-20261118-001) ──────────────────
// Invitation, day-before reminder and change / cancellation. Copy lives in
// MeetingAttendance.email.*. The answer links open a page with a single
// "Potvrdiť" tap — opening a link never writes (mail scanners prefetch).
// The app makes no claim that this e-mail is the statutory §14a ods. 2
// notice (spec L1).

export interface MeetingEmailParams {
  recipientEmail: string;
  recipientName: string;
  meetingTitle: string;
  meetingDate: Date;
  meetingPlace: string | null;
  timeZone: string;
  detailUrl: string;
  /** Answer links (yes / no / maybe); omitted for a cancellation. */
  answerUrls?: { yes: string; no: string; maybe: string };
  locale?: string;
}

async function sendMeetingEmail(
  variant: "invitation" | "reminderYes" | "reminderOpen" | "change" | "cancel",
  params: MeetingEmailParams
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[email] SMTP not configured — skipping meeting ${variant}`);
    return false;
  }
  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "MeetingAttendance.email" });

  const dateLabel = params.meetingDate.toLocaleString(bcp47(locale), {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: params.timeZone,
  });
  const placeBlock = params.meetingPlace
    ? `<p style="margin: 4px 0;"><strong>${escapeHtml(t("whereLabel"))}:</strong> ${escapeHtml(params.meetingPlace)}</p>`
    : "";
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display: inline-block; margin: 4px; padding: 12px 24px; background-color: ${
      primary ? "#2563eb" : "#ffffff"
    }; color: ${primary ? "#ffffff" : "#1d4ed8"}; border: 2px solid #2563eb; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">${escapeHtml(label)}</a>`;
  const answers = params.answerUrls
    ? `<p style="margin-top: 24px; font-weight: bold;">${escapeHtml(t("answerQuestion"))}</p>
       <div style="margin: 8px 0 24px; text-align: center;">
         ${button(params.answerUrls.yes, t("answerYes"), true)}
         ${button(params.answerUrls.no, t("answerNo"), false)}
         ${button(params.answerUrls.maybe, t("answerMaybe"), false)}
       </div>
       <p style="color: #6b7280; font-size: 14px;">${escapeHtml(t("answerNote"))}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${await brandingEmailHeader()}
      <h2 style="color: #1d4ed8;">${escapeHtml(t(`${variant}.heading`))}</h2>
      <p>${escapeHtml(tCommon("greeting", { name: params.recipientName }))}</p>
      <p>${escapeHtml(t(`${variant}.intro`))}</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
        <p style="margin: 4px 0; font-weight: bold; font-size: 18px; color: #111827;">${escapeHtml(params.meetingTitle)}</p>
        <p style="margin: 4px 0;"><strong>${escapeHtml(t("whenLabel"))}:</strong> ${escapeHtml(dateLabel)}</p>
        ${placeBlock}
      </div>
      ${answers}
      <p style="margin-top: 16px;"><a href="${escapeHtml(params.detailUrl)}">${escapeHtml(t("detailLink"))}</a></p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">${escapeHtml(t("footer"))}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: t(`${variant}.subject`, { title: params.meetingTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error(`[email] Failed to send meeting ${variant}:`, error);
    return false;
  }
}

export function sendMeetingInvitation(params: MeetingEmailParams): Promise<boolean> {
  return sendMeetingEmail("invitation", params);
}

/** `answered` = the owner said yes / maybe; otherwise they have not answered yet. */
export function sendMeetingReminder(
  params: MeetingEmailParams & { answered: boolean }
): Promise<boolean> {
  return sendMeetingEmail(params.answered ? "reminderYes" : "reminderOpen", params);
}

export function sendMeetingChange(
  params: MeetingEmailParams & { cancelled: boolean }
): Promise<boolean> {
  return sendMeetingEmail(params.cancelled ? "cancel" : "change", params);
}

import { getTranslations } from "next-intl/server";
import { getTransporter, EMAIL_FROM } from "@/lib/email";
import { routing } from "@/i18n/routing";
import { timeZoneForCountry } from "@/lib/time-zone";
import type { Country, VoteChoice } from "@/types";

// Vote e-mails (BYT-20261117-002 Phase 6). Strings come from
// messages/{locale}.json → Email.vote, in the voter's locale.
//
//  - sendVoteConfirmationLink: the single-use confirmation link. Opening it
//    shows a page that states the ballot; only the POST from that page
//    records the vote (a GET never does — mail scanners prefetch links).
//  - sendVoteConfirmation: the receipt after an electronic ballot was
//    recorded (voter + unit + every item choice + time + ballot hash).
//    For SK communities it cites §14a ods. 5 zák. 182/1993 Z.z.; the
//    statutory line is not shown for other countries.
//  - sendWithdrawConfirmationLink: the single-use link that withdraws the
//    current electronic ballot (only the POST from its page withdraws).
// Times are shown in the community's time zone (from its country), never
// in the server's.
//
// Module-internal email helper. Once the SDK delta ships `sdk.email.send`,
// this becomes `await ctx.sdk.email.send({ template, locale, data, to })`
// and the raw transport import is removed (RES-20260505-001 §"Email and
// notifications", RES-20260428-002 §"SDK shape").

type EmailLocale = (typeof routing.locales)[number];

function resolveLocale(input?: string | null): EmailLocale {
  if (input && (routing.locales as readonly string[]).includes(input)) {
    return input as EmailLocale;
  }
  return routing.defaultLocale as EmailLocale;
}

const BCP47: Record<EmailLocale, string> = { sk: "sk-SK", en: "en-GB", cs: "cs-CZ" };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface VoteEmailItem {
  idx: number;
  title: string;
  choice: VoteChoice;
}

function itemRows(
  items: VoteEmailItem[],
  t: Awaited<ReturnType<typeof getTranslations>>
): string {
  return items
    .map(
      (i) => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 8px 8px 0; color: #111827;">${esc(
            t("itemLabel", { number: i.idx + 1 })
          )} — ${esc(i.title)}</td>
          <td style="padding: 8px 0; font-weight: bold; white-space: nowrap;">${esc(
            t(`choice.${i.choice}`)
          )}</td>
        </tr>`
    )
    .join("");
}

export async function sendVoteConfirmationLink(params: {
  recipientEmail: string;
  voterName: string;
  votingTitle: string;
  flatNumber: string;
  items: VoteEmailItem[];
  confirmUrl: string;
  expiresAt: Date;
  /** Inline first-vote flow: the same link also activates the new passkey. */
  activatesPasskey?: boolean;
  country: Country;
  locale?: string | null;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured — cannot send vote confirmation link");
    return false;
  }
  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.vote" });
  const expires = params.expiresAt.toLocaleTimeString(BCP47[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZoneForCountry(params.country),
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${esc(t("linkHeading"))}</h2>
      <p>${esc(tCommon("greeting", { name: params.voterName }))}</p>
      <p>${esc(t("linkIntro", { voting: params.votingTitle, flat: params.flatNumber }))}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${itemRows(
        params.items,
        t
      )}</table>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${esc(params.confirmUrl)}"
           style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${esc(t("linkButton"))}
        </a>
      </div>
      ${
        params.activatesPasskey
          ? `<p style="color: #374151;">${esc(t("linkActivatesPasskey"))}</p>`
          : ""
      }
      <p style="color: #374151;">${esc(t("linkExpiry", { time: expires }))}</p>
      <p style="color: #6b7280; font-size: 14px;">${esc(t("linkNotYou"))}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: params.recipientEmail,
      subject: t("linkSubject", { voting: params.votingTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send vote confirmation link:", error);
    return false;
  }
}

/** Receipt after an electronic ballot was recorded. Best effort. */
export async function sendVoteConfirmation(params: {
  recipientEmail: string;
  voterName: string;
  votingTitle: string;
  flatNumber: string;
  items: VoteEmailItem[];
  timestamp: Date;
  ballotHash: string;
  method: "passkey" | "email";
  country: Country;
  locale?: string | null;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured — skipping vote confirmation email");
    return false;
  }
  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.vote" });
  const when = params.timestamp.toLocaleString(BCP47[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timeZoneForCountry(params.country),
    timeZoneName: "short",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${esc(t("receiptHeading"))}</h2>
      <p>${esc(tCommon("greeting", { name: params.voterName }))}</p>
      <p>${esc(t("receiptIntro", { voting: params.votingTitle, flat: params.flatNumber }))}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${itemRows(
        params.items,
        t
      )}</table>
      <p style="color: #374151;">${esc(t("receiptWhen", { date: when }))}</p>
      <p style="color: #374151;">${esc(t(`receiptMethod.${params.method}`))}</p>
      <p style="color: #6b7280; font-size: 12px;">${esc(t("receiptHash"))}<br/>
        <span style="font-family: monospace; word-break: break-all;">${esc(params.ballotHash)}</span>
      </p>
      ${
        params.country === "sk"
          ? `<p style="color: #6b7280; font-size: 12px;">${esc(t("receiptLegalSk"))}</p>`
          : ""
      }
    </div>
  `;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: params.recipientEmail,
      subject: t("receiptSubject", { voting: params.votingTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send vote confirmation:", error);
    return false;
  }
}

/** Single-use link that withdraws the voter's current electronic ballot. */
export async function sendWithdrawConfirmationLink(params: {
  recipientEmail: string;
  voterName: string;
  votingTitle: string;
  flatNumber: string;
  confirmUrl: string;
  expiresAt: Date;
  country: Country;
  locale?: string | null;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured — cannot send withdraw confirmation link");
    return false;
  }
  const locale = resolveLocale(params.locale);
  const tCommon = await getTranslations({ locale, namespace: "Email.common" });
  const t = await getTranslations({ locale, namespace: "Email.vote" });
  const expires = params.expiresAt.toLocaleTimeString(BCP47[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZoneForCountry(params.country),
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">${esc(t("withdrawHeading"))}</h2>
      <p>${esc(tCommon("greeting", { name: params.voterName }))}</p>
      <p>${esc(t("withdrawIntro", { voting: params.votingTitle, flat: params.flatNumber }))}</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${esc(params.confirmUrl)}"
           style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          ${esc(t("withdrawButton"))}
        </a>
      </div>
      <p style="color: #374151;">${esc(t("withdrawExpiry", { time: expires }))}</p>
      <p style="color: #6b7280; font-size: 14px;">${esc(t("withdrawNotYou"))}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: params.recipientEmail,
      subject: t("withdrawSubject", { voting: params.votingTitle }),
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send withdraw confirmation link:", error);
    return false;
  }
}

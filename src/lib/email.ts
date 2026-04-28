import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM || "noreply@mojabytovka.sk";

function getTransporter() {
  if (!smtpHost || !smtpUser || !smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
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
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping community response notification"
    );
    return false;
  }

  const safePreview =
    params.responseContent.length > 240
      ? params.responseContent.slice(0, 240) + "…"
      : params.responseContent;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Nová reakcia na váš príspevok</h2>
      <p>Vážený/á <strong>${params.recipientName}</strong>,</p>
      <p><strong>${params.responderName}</strong> reagoval/a na váš príspevok:</p>
      <p style="font-weight: bold; color: #111827;">${params.postTitle}</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background-color: #f3f4f6; border-left: 4px solid #2563eb; border-radius: 4px; color: #374151;">
        ${safePreview.replace(/\n/g, "<br/>")}
      </blockquote>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Zobraziť príspevok
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        Odpovedať môžete priamo v aplikácii.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: `Nová reakcia — ${params.postTitle}`,
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
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping post expiry reminder"
    );
    return false;
  }

  const expiresLabel = params.expiresAt.toLocaleDateString("sk-SK");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Váš príspevok čoskoro vyprší</h2>
      <p>Vážený/á <strong>${params.recipientName}</strong>,</p>
      <p>Váš príspevok <strong>${params.postTitle}</strong> bude označený ako neaktívny dňa <strong>${expiresLabel}</strong>.</p>
      <p>Ak je téma stále aktuálna, môžete príspevok predĺžiť alebo upraviť v aplikácii.</p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Spravovať príspevok
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: `Príspevok čoskoro vyprší — ${params.postTitle}`,
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
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping event reminder"
    );
    return false;
  }

  const dateLabel = params.eventDate.toLocaleString("sk-SK", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const locationBlock = params.eventLocation
    ? `<p style="margin: 4px 0;"><strong>Miesto:</strong> ${params.eventLocation}</p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Pripomienka udalosti</h2>
      <p>Vážený/á <strong>${params.recipientName}</strong>,</p>
      <p>Zajtra sa koná udalosť, na ktorú ste sa prihlásili:</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
        <p style="margin: 4px 0; font-weight: bold; font-size: 18px; color: #111827;">${params.eventTitle}</p>
        <p style="margin: 4px 0;"><strong>Kedy:</strong> ${dateLabel}</p>
        ${locationBlock}
      </div>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${params.postUrl}"
           style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Detail udalosti
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: `Pripomienka — ${params.eventTitle}`,
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send event reminder:", error);
    return false;
  }
}

export async function sendVoteConfirmation(params: {
  recipientEmail: string;
  voterName: string;
  votingTitle: string;
  flatNumber: string;
  choice: string;
  timestamp: Date;
  auditHash: string;
}): Promise<boolean> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      "[email] SMTP not configured — skipping vote confirmation email"
    );
    return false;
  }

  const choiceLabels: Record<string, string> = {
    za: "ZA",
    proti: "PROTI",
    zdrzal_sa: "ZDRŽAL SA",
  };

  const choiceLabel = choiceLabels[params.choice] || params.choice;
  const formattedDate = params.timestamp.toLocaleString("sk-SK");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1d4ed8;">Potvrdenie elektronického hlasovania</h2>
      <p>Vážený/á <strong>${params.voterName}</strong>,</p>
      <p>Váš hlas bol úspešne zaznamenaný.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Hlasovanie:</td>
          <td style="padding: 8px 0; font-weight: bold;">${params.votingTitle}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Byt:</td>
          <td style="padding: 8px 0; font-weight: bold;">${params.flatNumber}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Hlas:</td>
          <td style="padding: 8px 0; font-weight: bold;">${choiceLabel}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Dátum a čas:</td>
          <td style="padding: 8px 0;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Audit hash:</td>
          <td style="padding: 8px 0; font-family: monospace; font-size: 12px; word-break: break-all;">${params.auditHash}</td>
        </tr>
      </table>
      <p style="color: #6b7280; font-size: 12px;">
        Toto potvrdenie je zaslané v súlade s §14a ods. 5 zákona č. 182/1993 Z.z.
        o vlastníctve bytov a nebytových priestorov.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: params.recipientEmail,
      subject: `Potvrdenie hlasu — ${params.votingTitle}`,
      html,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send vote confirmation:", error);
    return false;
  }
}

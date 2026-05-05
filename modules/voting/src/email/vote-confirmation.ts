import { getTransporter, EMAIL_FROM } from "@/lib/email";

// Vote confirmation email — sent on every electronic vote insert/update.
// Required by SK §14a ods. 5 zák. 182/1993 Z.z. (audit trail of voter
// + flat + choice + timestamp + hash).
//
// Module-internal email helper. Once the SDK delta ships `sdk.email.send`,
// this becomes `await ctx.sdk.email.send({ template, locale, data, to })`
// and the raw transport import is removed (RES-20260505-001 §"Email and
// notifications", RES-20260428-002 §"SDK shape").

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
      from: EMAIL_FROM,
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

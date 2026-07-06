// QR Platba / SPAYD generator (CZ, Phase 6 prep) — pure module, no
// server imports. Short Payment Descriptor per the ČBA standard:
//   SPD*1.0*ACC:CZ...*AM:123.45*CC:CZK*X-VS:123*MSG:...
// Values must not contain '*'; '%' and '*' percent-encode. Amount uses
// dot decimals with exactly two places (integer-cents input — no float
// math on money).

export interface SpaydInput {
  iban: string;
  amountCents: number;
  /** Variabilní symbol (X-VS). */
  vs?: string | null;
  message?: string | null;
}

function sanitize(value: string): string {
  return value.replace(/%/g, "%25").replace(/\*/g, "%2A");
}

export function spaydString(input: SpaydInput): string {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
    throw new Error(`accounting: invalid IBAN for SPAYD "${input.iban}"`);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("accounting: SPAYD amount must be positive cents");
  }
  const whole = Math.floor(input.amountCents / 100);
  const frac = String(input.amountCents % 100).padStart(2, "0");

  const parts = [
    "SPD*1.0",
    `ACC:${iban}`,
    `AM:${whole}.${frac}`,
    "CC:CZK",
  ];
  if (input.vs) {
    if (!/^\d{1,10}$/.test(input.vs)) {
      throw new Error(`accounting: invalid VS for SPAYD "${input.vs}"`);
    }
    parts.push(`X-VS:${input.vs}`);
  }
  if (input.message) {
    // ČBA recommends ASCII; diacritics-strip and cap at 60 chars.
    const message = sanitize(
      input.message
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .slice(0, 60)
    );
    parts.push(`MSG:${message}`);
  }
  return parts.join("*");
}

// Client-safe IBAN validation (spec AC: "IBAN field validates MOD-97
// checksum") — pure, no imports. Used by the settings form and every
// server write path that stores an IBAN.

/** Uppercases and strips spaces; returns null when shape is invalid. */
export function normalizeIban(raw: string): string | null {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return null;
  return iban;
}

/** ISO 13616 MOD-97 check on a normalized IBAN. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!iban) return false;
  // Move the first 4 chars to the end, replace letters with 10..35, then
  // the number must be ≡ 1 (mod 97). Computed incrementally — the numeric
  // string exceeds Number precision.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value =
      ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

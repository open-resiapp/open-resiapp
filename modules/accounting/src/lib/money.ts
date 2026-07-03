// Client-safe money helpers — the ONLY EUR-string ↔ cents conversion in
// the module. No float math on money anywhere else; every money input
// screen imports these instead of rolling its own parser (they drift).

export interface ParseCentsOptions {
  /** Accept a leading minus (opening balances allow debts). */
  allowNegative?: boolean;
  /** Treat empty input as 0 instead of null. */
  emptyAsZero?: boolean;
}

/** "1 234,56" | "1234.56" → integer cents; null on garbage. */
export function parseCents(
  raw: string,
  { allowNegative = false, emptyAsZero = false }: ParseCentsOptions = {}
): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return emptyAsZero ? 0 : null;
  const re = allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!re.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeAbs = Math.abs(parseInt(whole, 10));
  const fracCents = parseInt(frac.padEnd(2, "0") || "0", 10);
  return sign * (wholeAbs * 100 + fracCents);
}

/** Cents → editable input string ("12,50"); empty for null. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Cents → display currency string in the given locale. */
export function formatEur(cents: number, locale = "sk-SK"): string {
  return (cents / 100).toLocaleString(locale, {
    style: "currency",
    currency: "EUR",
  });
}

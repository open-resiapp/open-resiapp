// Payment-symbol normalisation (VS / ŠS / KS) — pure, client-safe.
//
// Banks pad symbols with leading zeros or strip them (Fio, camt.053,
// Enable Banking all strip), while a treasurer may type "0012" into the
// unit settings. Symbols are numeric identifiers, so "0012" and "12" are
// the same symbol. Compare ONLY through this helper — stored values stay
// exactly as typed (no data rewrite).

/** "0012" → "12"; "", "000", null → null; whitespace ignored. */
export function normalizeSymbol(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const stripped = raw.replace(/\s+/g, "").replace(/^0+/, "");
  return stripped === "" ? null : stripped;
}

/** True when both symbols are present and equal after normalisation. */
export function symbolsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeSymbol(a);
  return na !== null && na === normalizeSymbol(b);
}

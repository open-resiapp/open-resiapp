// Electronic-delivery consent for the annual vyúčtovanie (BYT-20260512-002
// AC 426). PURE + client-safe (no server-only, no DB) so the delivery split
// is golden-tested and the same predicate runs on the client toggle.
//
// Legal note: giving consent RETROACTIVELY (a consent obtained after a
// document was already produced) is legally unsettled (§1184a NOZ / SK
// equivalent). The UI carries a "právne stanovisko sa čaká" disclaimer next
// to the toggle; this module only models the mechanical split.

/** The consent-tracking columns on notification_preferences. */
export interface EDeliveryConsentRow {
  consentAt: Date | string | null;
  withdrawnAt: Date | string | null;
}

/**
 * Active consent = a consent timestamp exists AND it has not since been
 * withdrawn. A withdrawal never erases consentAt (audit trail); re-consent
 * sets a fresh consentAt and nulls withdrawnAt, so this predicate holds.
 */
export function hasEDeliveryConsent(
  row: EDeliveryConsentRow | null | undefined
): boolean {
  if (!row || row.consentAt == null) return false;
  return row.withdrawnAt == null;
}

/**
 * Split settlement recipients into the electronic-delivery run (consenting
 * owners) and the postal print run (everyone else). Order within each list
 * is preserved from the input.
 */
export function partitionEDelivery<T extends { consented: boolean }>(
  recipients: T[]
): { eDelivery: T[]; postal: T[] } {
  const eDelivery: T[] = [];
  const postal: T[] = [];
  for (const r of recipients) (r.consented ? eDelivery : postal).push(r);
  return { eDelivery, postal };
}

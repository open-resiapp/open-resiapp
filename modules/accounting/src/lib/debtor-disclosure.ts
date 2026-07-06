// SK debtor NAME disclosure (BYT-20260512-002 AC 425). PURE + client-safe
// so the boundary rule is golden-tested and the UI can gray out the toggle
// consistently.
//
// §9 ods. 3 zák. 182/1993 Z.z. lets the spoločenstvo disclose an owner's
// name together with the sum ONLY once their nedoplatok reaches 500 €. That
// threshold is a STATUTE, hard-coded here — never a configurable setting
// (unlike the arrears-list threshold, which only decides which units appear
// as unit+amount). There is no CZ statutory equivalent, so name disclosure
// is refused for CZ regardless of the toggle.

/** Statutory 500 € threshold for owner-name disclosure (§9 ods. 3). */
export const SK_DEBTOR_NAME_THRESHOLD_CENTS = 50000;

export interface DiscloseNameInput {
  /** The dom's `debtorNamesEnabled` setting. */
  namesEnabled: boolean;
  country: "sk" | "cz";
  /** The unit's current nedoplatok (positive = owes), in cents. */
  balanceCents: number;
}

/**
 * May this unit's owner NAME be shown alongside the amount? True only when
 * the toggle is on, the dom is SK, and the nedoplatok is at/above the
 * statutory 500 €. Below 500 € (or CZ, or toggle off) → unit + amount only.
 */
export function discloseDebtorName(input: DiscloseNameInput): boolean {
  return (
    input.namesEnabled &&
    input.country === "sk" &&
    input.balanceCents >= SK_DEBTOR_NAME_THRESHOLD_CENTS
  );
}

/**
 * BYT-20260512-002 Phase 2 — match-engine check
 * (run: `pnpm test:accounting-match`).
 *
 * Guards the bank-line → unit matching rules (docs/domain/accounting.md
 * edge case 9 + spec §Bank import):
 *   - VS exact is primary and auto-applies
 *   - amount NEVER matches on its own (same-amount cross-match forbidden)
 *   - name fuzzy never auto-applies and requires uniqueness
 *   - IBAN shared across two units downgrades to no-match
 */
import {
  suggestMatch,
  nameSimilarity,
  AUTO_APPLY_THRESHOLD,
  type MatchableUnit,
} from "@modules/accounting/src/matching/match";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const units: MatchableUnit[] = [
  {
    unitEntityId: "u1",
    vs: "101",
    knownIbans: ["SK3112000000198742637541"],
    ownerNames: ["Ján Mrkvička"],
    openCents: 12050,
  },
  {
    unitEntityId: "u2",
    vs: "102",
    knownIbans: [],
    ownerNames: ["Mária Nováková", "Peter Novák"],
    openCents: 8700,
  },
  {
    unitEntityId: "u3",
    vs: "103",
    knownIbans: ["SK7509000000005044425629"],
    ownerNames: ["Ján Novotný"],
    openCents: 12050, // same open amount as u1 — cross-match trap
  },
];

console.log("VS exact (primary)");
{
  const m = suggestMatch(
    { vs: "101", ss: null, amountCents: 12050, counterpartyIban: null, counterpartyName: null },
    units
  );
  check("hits the VS unit", m.unitEntityId === "u1" && m.rule === "vs_exact");
  check("auto-applies", m.autoApply && m.confidence >= AUTO_APPLY_THRESHOLD);
  check("exact amount boosts to ~98+", m.confidence >= 98, String(m.confidence));

  const wrongAmount = suggestMatch(
    { vs: "101", ss: null, amountCents: 99999, counterpartyIban: null, counterpartyName: null },
    units
  );
  check("odd amount still VS-matches", wrongAmount.unitEntityId === "u1" && wrongAmount.autoApply);
  check("odd amount scores lower", wrongAmount.confidence < m.confidence);

  const unknownVs = suggestMatch(
    { vs: "999", ss: null, amountCents: 12050, counterpartyIban: null, counterpartyName: null },
    units
  );
  check("unknown VS does NOT fall back to amount", unknownVs.unitEntityId === null);
}

console.log("amount-only matching is forbidden");
{
  // u1 and u3 have identical open amounts; a line with only an amount
  // must match NOTHING (domain edge case 9).
  const m = suggestMatch(
    { vs: null, ss: null, amountCents: 12050, counterpartyIban: null, counterpartyName: null },
    units
  );
  check("no key → no match", m.unitEntityId === null && m.rule === "none");
}

console.log("known IBAN (secondary)");
{
  const m = suggestMatch(
    { vs: null, ss: null, amountCents: 12050, counterpartyIban: "SK3112000000198742637541", counterpartyName: null },
    units
  );
  check("IBAN hits u1", m.unitEntityId === "u1" && m.rule === "iban_known");
  check("exact amount → auto-apply", m.autoApply, String(m.confidence));

  const oddAmount = suggestMatch(
    { vs: null, ss: null, amountCents: 500, counterpartyIban: "SK3112000000198742637541", counterpartyName: null },
    units
  );
  check(
    "partial amount stays below auto threshold... or applies per policy",
    oddAmount.unitEntityId === "u1" && oddAmount.confidence < AUTO_APPLY_THRESHOLD === !oddAmount.autoApply
  );

  const shared = suggestMatch(
    { vs: null, ss: null, amountCents: 100, counterpartyIban: "SK0000000000000000000000", counterpartyName: null },
    [
      { ...units[0], knownIbans: ["SK0000000000000000000000"] },
      { ...units[2], knownIbans: ["SK0000000000000000000000"] },
    ]
  );
  check("IBAN shared by two units → no match", shared.unitEntityId === null);
}

console.log("name fuzzy (suggestion only)");
{
  check("similarity: exact", nameSimilarity("Ján Mrkvička", "Ján Mrkvička") === 1);
  check("similarity: diacritics-insensitive", nameSimilarity("JAN MRKVICKA", "Ján Mrkvička") === 1);
  check("similarity: reversed order", nameSimilarity("Mrkvička Ján", "Ján Mrkvička") === 1);
  check(
    "similarity: extra tokens ok",
    nameSimilarity("Ing. Ján Mrkvička a manželka", "Ján Mrkvička") === 1
  );
  check("similarity: different person low", nameSimilarity("Ján Novotný", "Ján Mrkvička") < 1);

  const m = suggestMatch(
    { vs: null, ss: null, amountCents: 8700, counterpartyIban: null, counterpartyName: "NOVAKOVA MARIA" },
    units
  );
  check("fuzzy suggests u2", m.unitEntityId === "u2" && m.rule === "name_fuzzy");
  check("fuzzy NEVER auto-applies", !m.autoApply);
  check("fuzzy confidence capped at 60", m.confidence <= 60);

  // Two owners named "Ján ..." must not cross-suggest via partial hits;
  // full-token containment is required.
  const partial = suggestMatch(
    { vs: null, ss: null, amountCents: 100, counterpartyIban: null, counterpartyName: "Ján" },
    units
  );
  check("first-name-only does not match", partial.unitEntityId === null);
}

console.log("priority: VS beats IBAN and name");
{
  const m = suggestMatch(
    {
      vs: "102",
      ss: "2026",
      amountCents: 8700,
      counterpartyIban: "SK3112000000198742637541", // u1's IBAN
      counterpartyName: "Ján Mrkvička", // u1's owner
    },
    units
  );
  check("VS wins over conflicting IBAN+name", m.unitEntityId === "u2" && m.rule === "vs_exact");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll match checks passed.");

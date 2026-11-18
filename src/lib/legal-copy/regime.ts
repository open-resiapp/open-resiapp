// Client-safe, pure. BYT-20261118-020 — which body of law governs a
// community's assembly, voting and statutory documents.
//
//   hoa         — SVB / SVJ: SK zák. 182/1993 Z. z.; CZ § 1158 a násl.
//                 zák. č. 89/2012 Sb. (bytové spoluvlastnictví)
//   cooperative — bytové družstvo: SK Obchodný zákonník 513/1991 Zb.
//                 § 221 – § 260; CZ zák. č. 90/2012 Sb. § 552 a násl.
//                 (bytové družstvo § 727 – § 757)
//   other       — every other template (garden, garage, clubs, …): no
//                 statute-specific copy is ever printed for them.
//
// Legacy installs (no template slug) are HOA — that is what the app was
// before templates existed (src/lib/templates/display-slug.ts).

export type LegalRegime = "hoa" | "cooperative" | "other";

/** Countries with statute-specific copy. Mirrors `Country` in @/types. */
export type LegalCountry = "sk" | "cz";

const COOPERATIVE_TEMPLATES = new Set(["bytove_druzstvo"]);
const HOA_TEMPLATES = new Set([
  "hoa",
  // legacy kind slugs persisted by pre-Phase-5 installs
  "housing_community",
  "housing_block",
  "housing_entrance",
  "housing_unit",
  "community",
]);

export function legalRegimeFor(templateSlug: string | null | undefined): LegalRegime {
  if (!templateSlug) return "hoa";
  if (COOPERATIVE_TEMPLATES.has(templateSlug)) return "cooperative";
  if (HOA_TEMPLATES.has(templateSlug)) return "hoa";
  return "other";
}

export function toLegalCountry(country: string | null | undefined): LegalCountry {
  return country === "cz" ? "cz" : "sk";
}

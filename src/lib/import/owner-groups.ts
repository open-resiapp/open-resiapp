// Client-safe, pure. One person owning several units inside one import
// (e.g. a flat + a garage, or two flats) must become ONE user, not one user
// per row. The validator (preview counts), the seeder (what it creates) and
// the preview UI (confirm / split control) all use this single grouping so
// the numbers the admin sees equal what the commit writes.
//
// Identity, strongest first:
//   1. e-mail (case-insensitive)
//   2. IČO (legal-entity owner from the LV)
//   3. normalised name + normalised address (+ rodné priezvisko when known)
// Birth dates are deliberately not used: the LV parser does not extract them
// (GDPR data minimisation). Two different people with the same name at the
// same address are the remaining edge case — the preview lists every group
// and the admin can split it.

import type { ImportRow, OwnerGroup } from "./types";

type OwnerFields = Pick<
  ImportRow,
  "owner_name" | "owner_email" | "owner_address" | "owner_ico" | "owner_birth_name"
>;
type UnitFields = Pick<ImportRow, "block_name" | "entrance_label" | "unit_number">;

const TITLE_RE =
  /^(?:ing|mgr|bc|mudr|judr|rndr|phdr|paeddr|mvdr|mddr|pharmdr|thdr|thlic|doc|prof|phd|csc|drsc|artd|mba|mpa|msc|bsc|dr|dipl|akad|arch|llm)\.?$/i;

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * "Novák Ján, Ing., r. Nováková" and "Ing. Ján Novák" → "jan novak".
 * Titles and the rodné priezvisko are dropped; token order is ignored (the
 * LV writes "Priezvisko Meno", a user typically "Meno Priezvisko").
 */
export function normaliseOwnerName(name: string): string {
  const cleaned = stripDiacritics(name.toLowerCase())
    .replace(/\br\.\s*\S+/g, " ")
    .replace(/[,;()]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !TITLE_RE.test(t) && !/^\.+$/.test(t));
  return tokens.sort().join(" ");
}

export function normaliseAddress(address: string | undefined): string {
  if (!address) return "";
  return stripDiacritics(address.toLowerCase())
    .replace(/\bpsc\b/g, " ")
    .replace(/,\s*sr\s*$/, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity key of the owner on one row (before any admin split). */
export function ownerIdentityKey(r: OwnerFields): string {
  const email = r.owner_email?.trim().toLowerCase();
  if (email) return `e:${email}`;
  const ico = r.owner_ico?.replace(/\s+/g, "");
  if (ico) return `i:${ico}`;
  const birth = r.owner_birth_name ? `|${normaliseOwnerName(r.owner_birth_name)}` : "";
  return `n:${normaliseOwnerName(r.owner_name)}|${normaliseAddress(r.owner_address)}${birth}`;
}

/** "Blok A / 2 / 12" — the unit as the admin reads it. */
export function importUnitLabel(r: UnitFields): string {
  return [r.block_name, r.entrance_label, r.unit_number].filter(Boolean).join(" / ");
}

/**
 * Effective owner key per row (0-based index → key). Rows of a group the admin
 * split get a per-row key, i.e. a separate user each.
 */
export function ownerKeysForRows(
  rows: (OwnerFields & UnitFields)[],
  splitGroups: Iterable<string> = []
): string[] {
  const split = new Set(splitGroups);
  return rows.map((r, idx) => {
    const k = ownerIdentityKey(r);
    return split.has(k) ? `${k}#${idx}` : k;
  });
}

/**
 * Groups with MORE than one row = one person, several units. Single-row
 * groups are omitted (nothing to confirm). Rows are 1-based grid rows.
 */
export function findOwnerGroups(rows: (OwnerFields & UnitFields)[]): OwnerGroup[] {
  const byKey = new Map<string, OwnerGroup>();
  rows.forEach((r, idx) => {
    const key = ownerIdentityKey(r);
    const g = byKey.get(key) ?? { key, name: r.owner_name, rows: [], units: [] };
    g.rows.push(idx + 1);
    const label = importUnitLabel(r);
    if (!g.units.includes(label)) g.units.push(label);
    byKey.set(key, g);
  });
  return [...byKey.values()].filter((g) => g.rows.length > 1);
}

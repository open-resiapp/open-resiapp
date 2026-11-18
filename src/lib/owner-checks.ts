// BYT-20261118-003 — informative consistency checks of the owner registry.
//
// Client-safe and pure: exact rationals (src/lib/rational.ts), no DB, no
// prose. Each finding carries a stable `code` that the UI maps to
// `OwnerHealth.checks.<code>.*`. Findings NEVER block anything (voting,
// import, editing) — data may be legally correct, e.g. an unresolved
// inheritance; the UI says "na kontrolu", not "chyba".

import { add, compare, eq as ratEq, rational, ZERO, type Rational } from "@/lib/rational";

export const CHECK_CODES = [
  "share_sum_mismatch",
  "unit_without_owner",
  "bsm_partner_missing",
  "bsm_share_mismatch",
  "bsm_too_many",
  "duplicate_ordinal",
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

/** Known `memberships.ownership_form` values; anything else is ignored. */
export const OWNERSHIP_FORMS = ["bsm"] as const;

export interface CheckUnit {
  id: string;
}

/** One ACTIVE OWNER membership on a live unit of the community. */
export interface CheckMembership {
  userId: string;
  unitId: string;
  shareNum: number;
  shareDen: number;
  lvOrdinal: number | null;
  ownershipForm: string | null;
}

export interface CheckFinding {
  code: CheckCode;
  /** Units the finding is about (one, except duplicate_ordinal). */
  unitIds: string[];
  userIds: string[];
  fingerprint: string;
  facts: {
    /** share_sum_mismatch: reduced sum. */
    sumNum?: string;
    sumDen?: string;
    direction?: "under" | "over";
    ordinal?: number | null;
    /** bsm_share_mismatch: "n/d" per spouse. */
    shares?: string[];
    /** bsm_too_many: memberships sharing the ordinal. */
    count?: number;
  };
}

export interface CheckOptions {
  /**
   * BSM / LV-ordinal checks — only for SK/CZ HOA communities (BSM / SJM is
   * a Slovak / Czech marital-property concept; ordinals exist only for
   * LV-imported units).
   */
  lvChecks: boolean;
}

const MAX_FP = 128;

/** Short deterministic hash (FNV-1a, 2×32 bit) for long fingerprints. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function fp(code: CheckCode, parts: (string | number | null)[]): string {
  const raw = `check:${code}:${parts.map((p) => (p === null ? "-" : String(p))).join(":")}`;
  return raw.length <= MAX_FP ? raw : `check:${code}:${hash(raw)}`;
}

function shareOf(m: CheckMembership): Rational | null {
  if (!Number.isInteger(m.shareNum) || !Number.isInteger(m.shareDen) || m.shareDen <= 0) return null;
  return rational(m.shareNum, m.shareDen);
}

function isBsm(m: CheckMembership): boolean {
  return m.ownershipForm === "bsm";
}

export function runOwnershipChecks(
  units: readonly CheckUnit[],
  memberships: readonly CheckMembership[],
  opts: CheckOptions
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const unitIds = new Set(units.map((u) => u.id));
  const byUnit = new Map<string, CheckMembership[]>();
  for (const m of memberships) {
    if (!unitIds.has(m.unitId)) continue;
    const list = byUnit.get(m.unitId) ?? [];
    list.push(m);
    byUnit.set(m.unitId, list);
  }

  // ── Per unit: share sum, no owner ─────────────────────────────────
  for (const u of units) {
    const list = byUnit.get(u.id) ?? [];
    if (list.length === 0) {
      findings.push({
        code: "unit_without_owner",
        unitIds: [u.id],
        userIds: [],
        fingerprint: fp("unit_without_owner", [u.id]),
        facts: {},
      });
      continue;
    }
    let total: Rational = ZERO;
    for (const m of list) {
      const s = shareOf(m);
      if (s) total = add(total, s);
    }
    if (total.num > 0n && total.num !== total.den) {
      const sum = `${total.num}/${total.den}`;
      findings.push({
        code: "share_sum_mismatch",
        unitIds: [u.id],
        userIds: list.map((m) => m.userId).sort(),
        fingerprint: fp("share_sum_mismatch", [u.id, sum]),
        facts: {
          sumNum: total.num.toString(),
          sumDen: total.den.toString(),
          direction: compare(total, rational(1, 1)) < 0 ? "under" : "over",
        },
      });
    }
  }

  if (!opts.lvChecks) return findings;

  // ── BSM pairs: same unit + same ordinal ───────────────────────────
  for (const [unitId, list] of byUnit) {
    const groups = new Map<string, CheckMembership[]>();
    for (const m of list) {
      if (!isBsm(m)) continue;
      const key = m.lvOrdinal === null ? "-" : String(m.lvOrdinal);
      const g = groups.get(key) ?? [];
      g.push(m);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const ordinal = g[0].lvOrdinal;
      const userIds = g.map((m) => m.userId).sort();
      if (g.length === 1) {
        findings.push({
          code: "bsm_partner_missing",
          unitIds: [unitId],
          userIds,
          fingerprint: fp("bsm_partner_missing", [unitId, ordinal, userIds[0]]),
          facts: { ordinal },
        });
      } else if (g.length === 2) {
        const [a, b] = g.map(shareOf);
        if (!a || !b || !ratEq(a, b)) {
          const shares = g.map((m) => `${m.shareNum}/${m.shareDen}`);
          findings.push({
            code: "bsm_share_mismatch",
            unitIds: [unitId],
            userIds,
            fingerprint: fp("bsm_share_mismatch", [unitId, ordinal, ...shares]),
            facts: { ordinal, shares },
          });
        }
      } else {
        findings.push({
          code: "bsm_too_many",
          unitIds: [unitId],
          userIds,
          fingerprint: fp("bsm_too_many", [unitId, ordinal, g.length]),
          facts: { ordinal, count: g.length },
        });
      }
    }
  }

  // ── Duplicate LV ordinal across the community ─────────────────────
  // Allowed: one ordinal on ONE unit where every holder is BSM (a pair, or a
  // broken pair the BSM checks above already report).
  const byOrdinal = new Map<number, CheckMembership[]>();
  for (const list of byUnit.values()) {
    for (const m of list) {
      if (m.lvOrdinal === null) continue;
      const g = byOrdinal.get(m.lvOrdinal) ?? [];
      g.push(m);
      byOrdinal.set(m.lvOrdinal, g);
    }
  }
  for (const [ordinal, g] of byOrdinal) {
    if (g.length < 2) continue;
    const units = [...new Set(g.map((m) => m.unitId))].sort();
    if (units.length === 1 && g.every(isBsm)) continue;
    const userIds = g.map((m) => m.userId).sort();
    findings.push({
      code: "duplicate_ordinal",
      unitIds: units,
      userIds,
      fingerprint: fp("duplicate_ordinal", [ordinal, ...units, ...userIds]),
      facts: { ordinal },
    });
  }

  const rank = (c: CheckCode) => CHECK_CODES.indexOf(c);
  return findings.sort((a, b) => rank(a.code) - rank(b.code));
}

// Bank-line → unit matching engine (BYT-20260512-002 Phase 2) — pure
// functions, no DB access. Domain rule (docs/domain/accounting.md edge
// case 9): VS is the PRIMARY matching key; amount-only matching is
// forbidden (same-amount payments from different owners cross-match).
//
// Pipeline (spec §Bank import):
//   1. VS → unit (exact, from unit settings)          → auto-apply
//   2. ŠS → period/month hint                          → tiebreak only
//   3. counterparty IBAN known for a unit              → auto-apply
//   4. counterparty name fuzzy                         → suggestion ONLY
//
// Confidence is 0–100; callers auto-apply at >= AUTO_APPLY_THRESHOLD and
// otherwise queue the line for the reconciliation UI.

export const AUTO_APPLY_THRESHOLD = 90;

export interface MatchableUnit {
  unitEntityId: string;
  vs: string | null;
  /** Counterparty IBANs seen on this unit's previous matched payments. */
  knownIbans: string[];
  /** Owner display names (active owner memberships). */
  ownerNames: string[];
  /** The unit's current open (due, unpaid) total — amount plausibility. */
  openCents: number;
}

export interface MatchableLine {
  vs: string | null;
  ss: string | null;
  amountCents: number;
  counterpartyIban: string | null;
  counterpartyName: string | null;
}

export type MatchRule = "vs_exact" | "iban_known" | "name_fuzzy" | "none";

export interface MatchSuggestion {
  unitEntityId: string | null;
  confidence: number;
  rule: MatchRule;
  /** True when the caller may post the match without human review. */
  autoApply: boolean;
}

// ── name normalization ─────────────────────────────────

/** Lowercase, diacritics stripped, split into tokens, titles dropped. */
export function nameTokens(raw: string): string[] {
  const TITLES = new Set(["ing", "mgr", "judr", "mudr", "phdr", "rndr", "bc", "phd", "csc", "dr"]);
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !TITLES.has(t.replace(/\.$/, "")));
}

/**
 * Token containment ratio between a bank counterparty name and an owner
 * name — 1 when every owner-name token appears in the counterparty (word
 * order and extra tokens like "a manzelka" don't matter).
 */
export function nameSimilarity(counterparty: string, owner: string): number {
  const a = new Set(nameTokens(counterparty));
  const b = nameTokens(owner);
  if (a.size === 0 || b.length === 0) return 0;
  const hits = b.filter((t) => a.has(t)).length;
  return hits / b.length;
}

// ── matching ───────────────────────────────────────────

/** Amount plausibility bonus: paying ≈ the open amount (±1 %) or less. */
function amountBonus(line: MatchableLine, unit: MatchableUnit): number {
  if (unit.openCents <= 0) return 0;
  const diff = Math.abs(line.amountCents - unit.openCents);
  if (diff <= Math.max(1, Math.round(unit.openCents * 0.01))) return 5;
  if (line.amountCents < unit.openCents) return 2;
  return 0;
}

export function suggestMatch(
  line: MatchableLine,
  units: MatchableUnit[]
): MatchSuggestion {
  // 1. VS exact — the primary key. A VS collision cannot happen (unique
  // per dom), so a hit is near-certain; amount only tunes the score.
  if (line.vs) {
    const unit = units.find((u) => u.vs === line.vs);
    if (unit) {
      const confidence = Math.min(100, 93 + amountBonus(line, unit) + (line.ss ? 2 : 0));
      return {
        unitEntityId: unit.unitEntityId,
        confidence,
        rule: "vs_exact",
        autoApply: true,
      };
    }
  }

  // 2. Known counterparty IBAN — strong, but an owner can pay for two
  // units from one account; require uniqueness across units.
  if (line.counterpartyIban) {
    const owners = units.filter((u) =>
      u.knownIbans.includes(line.counterpartyIban!)
    );
    if (owners.length === 1) {
      const unit = owners[0];
      const confidence = Math.min(100, 85 + amountBonus(line, unit));
      return {
        unitEntityId: unit.unitEntityId,
        confidence,
        rule: "iban_known",
        autoApply: confidence >= AUTO_APPLY_THRESHOLD,
      };
    }
  }

  // 3. Name fuzzy — NEVER auto-applied (spec: suggestion only).
  if (line.counterpartyName) {
    let best: { unit: MatchableUnit; score: number } | null = null;
    let bestIsUnique = true;
    for (const unit of units) {
      for (const owner of unit.ownerNames) {
        const score = nameSimilarity(line.counterpartyName, owner);
        if (score < 0.99) continue;
        if (best && best.unit.unitEntityId !== unit.unitEntityId) {
          bestIsUnique = false;
        }
        if (!best || score > best.score) best = { unit, score };
      }
    }
    if (best && bestIsUnique) {
      return {
        unitEntityId: best.unit.unitEntityId,
        confidence: Math.min(60, 50 + amountBonus(line, best.unit)),
        rule: "name_fuzzy",
        autoApply: false,
      };
    }
  }

  return { unitEntityId: null, confidence: 0, rule: "none", autoApply: false };
}

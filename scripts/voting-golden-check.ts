/**
 * BYT-20260609-008 Phase 2 golden check (run: `pnpm test:voting-golden`).
 *
 * No test runner is configured in this repo, so this is a self-contained
 * tsx script (like db:seed). It exits non-zero on the first failure.
 *
 * It guards two contracts:
 *   1. Byte-identical results — a single-item voting resolved through the
 *      new per-item wrapper (calculateItemResults) produces exactly the same
 *      VotingResults as the legacy single-question path (calculateResults).
 *      This is what migration 0046's one-item backfill relies on.
 *   2. Hash parity — computeBallotHash / computeItemAuditHash reproduce the
 *      exact canonical strings that migration 0046 hashes in SQL.
 */
import { createHash } from "crypto";

import {
  calculateResults,
  calculateItemResults,
  computeBallotHash,
  computeItemAuditHash,
} from "@modules/voting/src/engine";
import {
  escalateRepeatedQuorum,
  getAvailableQuorumTypes,
} from "@modules/voting/src/rules";
import { validateNotice } from "@modules/voting/src/workflow/notice";
import { checkTransition } from "@modules/voting/src/workflow/transitions";
import type {
  Country,
  QuorumType,
  VoteChoice,
  VoteWithOwnership,
  VotingMethod,
} from "@/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const sha = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");

// ── vote builder ────────────────────────────────────────
let uid = 0;
function vote(
  unit: string,
  choice: VoteChoice,
  opts: Partial<VoteWithOwnership> = {}
): VoteWithOwnership {
  return {
    unitEntityId: unit,
    userId: `u${uid++}`,
    userName: `Owner ${uid}`,
    choice,
    unitShareNumerator: opts.unitShareNumerator ?? 1,
    unitShareDenominator: opts.unitShareDenominator ?? 10,
    area: opts.area ?? null,
    ownerUnitShareNumerator: opts.ownerUnitShareNumerator ?? 1,
    ownerUnitShareDenominator: opts.ownerUnitShareDenominator ?? 1,
    membershipWeight: opts.membershipWeight,
  };
}

// ── (1) byte-identical: legacy path vs single-item wrapper ──
interface Scenario {
  name: string;
  votes: VoteWithOwnership[];
  method: VotingMethod;
  quorum: QuorumType;
  tpw: number;
  country: Country;
}

const scenarios: Scenario[] = [
  {
    name: "single owner, weighted_by_share, simple_all",
    votes: [vote("A", "za")],
    method: "weighted_by_share",
    quorum: "simple_all",
    tpw: 1,
    country: "sk",
  },
  {
    name: "co-owner majority share (2/3 za vs 1/3 proti)",
    votes: [
      vote("A", "za", { ownerUnitShareNumerator: 2, ownerUnitShareDenominator: 3 }),
      vote("A", "proti", { ownerUnitShareNumerator: 1, ownerUnitShareDenominator: 3 }),
    ],
    method: "weighted_by_share",
    quorum: "simple_present",
    tpw: 1,
    country: "sk",
  },
  {
    name: "co-owner tie (1/2 za vs 1/2 proti) → abstain",
    votes: [
      vote("A", "za", { ownerUnitShareNumerator: 1, ownerUnitShareDenominator: 2 }),
      vote("A", "proti", { ownerUnitShareNumerator: 1, ownerUnitShareDenominator: 2 }),
    ],
    method: "weighted_by_share",
    quorum: "simple_present",
    tpw: 1,
    country: "sk",
  },
  {
    name: "member-scoped one_per_member",
    votes: [
      vote("A", "za", { membershipWeight: 1 }),
      vote("B", "proti", { membershipWeight: 1 }),
      vote("C", "za", { membershipWeight: 1 }),
    ],
    method: "one_per_member",
    quorum: "simple_present",
    tpw: 3,
    country: "sk",
  },
  {
    name: "CZ silence-is-no (turnout below total)",
    votes: [vote("A", "za", { unitShareNumerator: 3, unitShareDenominator: 10 })],
    method: "weighted_by_share",
    quorum: "simple_all",
    tpw: 10,
    country: "cz",
  },
  {
    name: "two_thirds_all quorum",
    votes: [
      vote("A", "za", { unitShareNumerator: 7, unitShareDenominator: 10 }),
    ],
    method: "weighted_by_share",
    quorum: "two_thirds_all",
    tpw: 10,
    country: "sk",
  },
  {
    name: "no votes cast (empty set)",
    votes: [],
    method: "weighted_by_share",
    quorum: "simple_all",
    tpw: 10,
    country: "sk",
  },
];

console.log("byte-identical: legacy calculateResults vs 1-item wrapper");
for (const s of scenarios) {
  const legacy = calculateResults(s.votes, s.method, s.quorum, s.tpw, {
    country: s.country,
  });
  const [item] = calculateItemResults(
    [{ id: "item-0", quorumType: s.quorum }],
    new Map([["item-0", s.votes]]),
    s.method,
    s.tpw,
    { country: s.country }
  );
  // Strip itemId; the rest must be byte-identical.
  const { itemId, ...itemRest } = item;
  check(
    s.name,
    JSON.stringify(legacy) === JSON.stringify(itemRest),
    `itemId=${itemId}\n      legacy=${JSON.stringify(legacy)}\n      item  =${JSON.stringify(itemRest)}`
  );
}

// ── (2) per-item independence ───────────────────────────
console.log("per-item independence (own quorum per item)");
{
  // 60% za: passes simple_all (>50%) but fails two_thirds_all (<66.6%).
  // weighted_by_share uses the share fraction as weight, so a single 6/10
  // unit contributes 0.6 against a total possible weight of 1.
  const votes = [vote("A", "za", { unitShareNumerator: 6, unitShareDenominator: 10 })];
  const tpw = 1;
  const results = calculateItemResults(
    [
      { id: "simple", quorumType: "simple_all" },
      { id: "twothirds", quorumType: "two_thirds_all" },
    ],
    new Map([
      ["simple", votes],
      ["twothirds", votes],
    ]),
    "weighted_by_share",
    tpw,
    { country: "sk" }
  );
  check("returns one result per item", results.length === 2);
  const simple = results.find((r) => r.itemId === "simple")!;
  const two = results.find((r) => r.itemId === "twothirds")!;
  check("simple_all item passes at 60%", simple.passed === true);
  check("two_thirds_all item fails at 60%", two.passed === false);
  check(
    "each item matches direct calculateResults",
    JSON.stringify({ ...simple, itemId: undefined }) ===
      JSON.stringify({
        ...calculateResults(votes, "weighted_by_share", "simple_all", tpw, {
          country: "sk",
        }),
        itemId: undefined,
      })
  );
}

// ── (3) hash parity with migration 0046 ─────────────────
console.log("hash parity with migration SQL");
{
  // Single-item ballot: exact canonical string the SQL builds.
  const bhCanonical = `[{"choice":"za","itemId":"i1"}]`;
  check(
    "computeBallotHash single item == sha256(canonical)",
    computeBallotHash([{ itemId: "i1", choice: "za" }]) === sha(bhCanonical)
  );

  // Multi-item ballot: sorted by itemId, keys lexicographic, no whitespace.
  const bhMulti = `[{"choice":"za","itemId":"a"},{"choice":"proti","itemId":"b"}]`;
  check(
    "computeBallotHash sorts by itemId + omits whitespace",
    computeBallotHash([
      { itemId: "b", choice: "proti" },
      { itemId: "a", choice: "za" },
    ]) === sha(bhMulti)
  );

  // itemAuditHash: pipe-joined, recordedAt via toISOString().
  const recordedAt = new Date("2026-06-09T10:20:30.123Z");
  const iahCanonical = `v1|i1|e1|o1|za|2026-06-09T10:20:30.123Z`;
  check(
    "computeItemAuditHash == sha256(pipe-joined | recordedAt ISO)",
    computeItemAuditHash({
      votingId: "v1",
      itemId: "i1",
      entityId: "e1",
      ownerId: "o1",
      choice: "za",
      recordedAt,
    }) === sha(iahCanonical)
  );
  check(
    "recordedAt uses millisecond ISO (matches to_char MS)",
    recordedAt.toISOString() === "2026-06-09T10:20:30.123Z"
  );
}

// ── (4) legal fixes 2026-11-18: quorum types, escalation, notice, transitions ──
console.log("legal fixes 2026-11-18");
{
  // four_fifths_all (SK §14b ods. 6): 8/10 passes, 7/10 fails.
  const at = (n: number) =>
    calculateResults(
      [vote("A", "za", { unitShareNumerator: n, unitShareDenominator: 10 })],
      "weighted_by_share",
      "four_fifths_all",
      1,
      { country: "sk" }
    ).passed;
  check("four_fifths_all passes at 80%", at(8) === true);
  check("four_fifths_all fails at 70%", at(7) === false);

  // Unanimity is robust to float summation order (0.1 + 0.2 + 0.7 vs total 1).
  const unanimous = calculateResults(
    [
      vote("A", "za", { unitShareNumerator: 1, unitShareDenominator: 10 }),
      vote("B", "za", { unitShareNumerator: 2, unitShareDenominator: 10 }),
      vote("C", "za", { unitShareNumerator: 7, unitShareDenominator: 10 }),
    ],
    "weighted_by_share",
    "all_unanimous",
    0.7 + 0.2 + 0.1,
    { country: "sk" }
  );
  check("all_unanimous passes when every share votes za", unanimous.passed === true);

  const skWritten = getAvailableQuorumTypes("sk", "written");
  check(
    "SK written offers exactly simple_present, simple_all, two_thirds_all, all_unanimous",
    JSON.stringify(skWritten) ===
      JSON.stringify(["simple_present", "simple_all", "two_thirds_all", "all_unanimous"])
  );
  const czWritten = getAvailableQuorumTypes("cz", "written");
  check(
    "CZ written unchanged (no simple_present)",
    JSON.stringify(czWritten) === JSON.stringify(["simple_all", "two_thirds_all", "all_unanimous"])
  );

  const esc = (q: QuorumType) => {
    const r = escalateRepeatedQuorum("sk", q);
    return r.ok ? r.quorumType : r.code;
  };
  check("§14b(6): simple_all → two_thirds_all", esc("simple_all") === "two_thirds_all");
  check("§14b(6): two_thirds_all → four_fifths_all", esc("two_thirds_all") === "four_fifths_all");
  check("§14b(6): simple_present → simple_all", esc("simple_present") === "simple_all");
  check("§14b(6): unanimity not applicable", esc("all_unanimous") === "REPEAT_ESCALATION_NOT_APPLICABLE");
  const cz = escalateRepeatedQuorum("cz", "simple_all");
  check("CZ has no escalation", !cz.ok && cz.code === "REPEAT_ESCALATION_UNSUPPORTED");

  // Notice D ⇒ start ≥ D+8 (civil days, Europe/Bratislava).
  const tz = "Europe/Bratislava";
  const d = new Date("2026-11-18T10:00:00Z");
  const ok = validateNotice({
    country: "sk", announcedAt: d, timeZone: tz,
    startsAt: new Date("2026-11-26T08:00:00Z"), endsAt: new Date("2026-12-10T08:00:00Z"),
  });
  const short = validateNotice({
    country: "sk", announcedAt: d, timeZone: tz,
    startsAt: new Date("2026-11-25T20:00:00Z"), endsAt: new Date("2026-12-10T08:00:00Z"),
  });
  check("notice: D+8 accepted", ok === null);
  check(
    "notice: D+7 rejected with minDate",
    short?.code === "NOTICE_LEAD_TIME_TOO_SHORT" && short.minDate === "2026-11-26"
  );
  const czNotice = validateNotice({
    country: "cz", announcedAt: d, timeZone: "Europe/Prague",
    startsAt: d, endsAt: new Date("2026-12-10T08:00:00Z"),
  });
  check("notice: CZ asserts no lead time", czNotice === null);

  // State machine.
  const st = (status: "draft" | "active" | "closed", published = false) => ({
    status, resultPublishedAt: published ? new Date() : null,
  });
  const code = (r: ReturnType<typeof checkTransition>) => (r.ok ? `ok:${r.to}` : r.code);
  check("draft → close not allowed", code(checkTransition(st("draft"), "close")) === "TRANSITION_NOT_ALLOWED");
  check("active → announce not allowed", code(checkTransition(st("active"), "announce")) === "TRANSITION_NOT_ALLOWED");
  check("reopen without note", code(checkTransition(st("closed"), "reopen", { note: "short" })) === "REOPEN_NOTE_REQUIRED");
  check(
    "reopen with note",
    code(checkTransition(st("closed"), "reopen", { note: "Doplnenie listinných hlasov" })) === "ok:active"
  );
  check(
    "reopen after publication refused",
    code(checkTransition(st("closed", true), "reopen", { note: "Doplnenie listinných hlasov" })) ===
      "RESULT_ALREADY_PUBLISHED"
  );
  check("publish only once", code(checkTransition(st("closed", true), "publish")) === "RESULT_ALREADY_PUBLISHED");
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll golden checks passed.");

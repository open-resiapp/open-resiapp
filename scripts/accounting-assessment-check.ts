/**
 * BYT-20260512-002 assessment-engine check
 * (run: `pnpm test:accounting-assessment`).
 *
 * Self-contained tsx script (same pattern as test:accounting-allocation).
 * Guards modules/accounting/src/engine/assessment.ts + splitByWeights
 * (docs/domain/accounting.md):
 *   - sum preservation per (service, month): per-unit amounts sum exactly
 *     to the dom-wide rate — cents never appear or vanish (invariant 10)
 *   - allocation keys resolve the documented basis (share, m², persons
 *     per month, equal, fixed)
 *   - publish preconditions fail loud: missing VS, missing share/area,
 *     zero-weight month
 *   - snapshot freezes the inputs verbatim (scope rule: publish-time
 *     snapshot, debt follows the person)
 */
import { splitByWeights } from "@modules/accounting/src/engine/allocation";
import {
  computeAssessments,
  type AssessmentUnitInput,
} from "@modules/accounting/src/engine/assessment";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function throws(name: string, fn: () => void, needle?: string) {
  try {
    fn();
    failures++;
    console.error(`  FAIL ${name} — did not throw`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (needle && !message.includes(needle)) {
      failures++;
      console.error(`  FAIL ${name} — wrong error: ${message}`);
    } else {
      console.log(`  ok  ${name}`);
    }
  }
}

// ── splitByWeights ─────────────────────────────────────

console.log("splitByWeights: basics");
{
  const thirds = splitByWeights(100, [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
    { id: "c", weight: 1 },
  ]);
  check(
    "1/3 split sums to total",
    thirds.reduce((s, p) => s + p.amountCents, 0) === 100
  );
  check(
    "1/3 split parts within 1 cent",
    thirds.every((p) => p.amountCents === 33 || p.amountCents === 34)
  );

  const shares = splitByWeights(10000, [
    { id: "a", weight: 4526 / 10000 },
    { id: "b", weight: 3474 / 10000 },
    { id: "c", weight: 2000 / 10000 },
  ]);
  check(
    "rational share weights sum-preserve",
    shares.reduce((s, p) => s + p.amountCents, 0) === 10000
  );
  check(
    "share proportions honored ±1 cent",
    Math.abs(shares[0].amountCents - 4526) <= 1 &&
      Math.abs(shares[1].amountCents - 3474) <= 1 &&
      Math.abs(shares[2].amountCents - 2000) <= 1
  );

  const zeroWeight = splitByWeights(500, [
    { id: "a", weight: 0 },
    { id: "b", weight: 2 },
  ]);
  check(
    "zero-weight part gets 0",
    zeroWeight[0].amountCents === 0 && zeroWeight[1].amountCents === 500
  );

  check(
    "zero total splits to zeros",
    splitByWeights(0, [
      { id: "a", weight: 1 },
      { id: "b", weight: 3 },
    ]).every((p) => p.amountCents === 0)
  );
}

console.log("splitByWeights: rejection");
throws("all-zero weights throw", () =>
  splitByWeights(100, [
    { id: "a", weight: 0 },
    { id: "b", weight: 0 },
  ])
);
throws("negative weight throws", () =>
  splitByWeights(100, [{ id: "a", weight: -1 }])
);
throws("negative total throws", () =>
  splitByWeights(-5, [{ id: "a", weight: 1 }])
);

console.log("splitByWeights: property sweep (seeded)");
{
  // Deterministic LCG so failures reproduce.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  let ok = true;
  for (let run = 0; run < 2000 && ok; run++) {
    const n = 1 + Math.floor(rand() * 12);
    const parts = Array.from({ length: n }, (_, i) => ({
      id: String(i),
      weight: rand() < 0.1 ? 0 : rand() * 100,
    }));
    if (parts.every((p) => p.weight === 0)) parts[0].weight = 1;
    const total = Math.floor(rand() * 100000);
    const split = splitByWeights(total, parts);
    const sum = split.reduce((s, p) => s + p.amountCents, 0);
    const weightSum = parts.reduce((s, p) => s + p.weight, 0);
    for (let i = 0; i < n; i++) {
      const exact = (total * parts[i].weight) / weightSum;
      if (Math.abs(split[i].amountCents - exact) >= 1.000001) {
        ok = false;
        console.error(
          `    run ${run}: part ${i} drifted >1 cent (${split[i].amountCents} vs ${exact})`
        );
      }
      if (split[i].amountCents < 0) ok = false;
    }
    if (sum !== total) {
      ok = false;
      console.error(`    run ${run}: sum ${sum} != total ${total}`);
    }
  }
  check("2000 runs: sum + ±1c proportion + non-negative", ok);
}

// ── computeAssessments ─────────────────────────────────

const units: AssessmentUnitInput[] = [
  {
    unitEntityId: "u1",
    vs: "101",
    shareNumerator: 4526,
    shareDenominator: 10000,
    areaM2: 75.5,
    ownerUserIds: ["owner1"],
    personsByMonth: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [i + 1, i + 1 < 7 ? 2 : 3])
    ),
  },
  {
    unitEntityId: "u2",
    vs: "102",
    shareNumerator: 3474,
    shareDenominator: 10000,
    areaM2: 60,
    ownerUserIds: ["owner2a", "owner2b"],
    personsByMonth: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [i + 1, 1])
    ),
  },
  {
    unitEntityId: "u3",
    vs: "103",
    shareNumerator: 2000,
    shareDenominator: 10000,
    areaM2: 40,
    ownerUserIds: [],
    personsByMonth: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [i + 1, 4])
    ),
  },
];

const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

console.log("computeAssessments: share key");
{
  const rows = computeAssessments({
    units,
    services: [
      {
        serviceCategoryId: "fpuo",
        allocationKey: "share",
        rateCents: 30000,
        fixedAmountCents: null,
      },
    ],
    months: allMonths,
  });
  check("12 months × 3 units rows", rows.length === 36);
  for (const month of [1, 12]) {
    const monthRows = rows.filter((r) => r.month === month);
    check(
      `month ${month} sums to rate`,
      monthRows.reduce((s, r) => s + r.amountCents, 0) === 30000
    );
  }
  const u1 = rows.find((r) => r.unitEntityId === "u1" && r.month === 1)!;
  check("share proportion ±1c", Math.abs(u1.amountCents - 13578) <= 1);
  check("vs snapshot on row", u1.vs === "101");
  check(
    "snapshot freezes share + owners",
    u1.allocationBasisSnapshot.shareNumerator === 4526 &&
      u1.allocationBasisSnapshot.ownerUserIds.length === 1 &&
      u1.allocationBasisSnapshot.totalUnits === 3
  );
}

console.log("computeAssessments: persons key varies by month");
{
  const rows = computeAssessments({
    units,
    services: [
      {
        serviceCategoryId: "voda",
        allocationKey: "persons",
        rateCents: 7000,
        fixedAmountCents: null,
      },
    ],
    months: allMonths,
  });
  const june = rows.filter((r) => r.month === 6);
  const july = rows.filter((r) => r.month === 7);
  check(
    "june sums to rate",
    june.reduce((s, r) => s + r.amountCents, 0) === 7000
  );
  check(
    "july sums to rate",
    july.reduce((s, r) => s + r.amountCents, 0) === 7000
  );
  const u1June = june.find((r) => r.unitEntityId === "u1")!;
  const u1July = july.find((r) => r.unitEntityId === "u1")!;
  check(
    "u1 pays more after persons increase",
    u1July.amountCents > u1June.amountCents,
    `${u1June.amountCents} → ${u1July.amountCents}`
  );
  check(
    "persons recorded in snapshot",
    u1June.allocationBasisSnapshot.persons === 2 &&
      u1July.allocationBasisSnapshot.persons === 3
  );
}

console.log("computeAssessments: fixed + equal keys");
{
  const rows = computeAssessments({
    units,
    services: [
      {
        serviceCategoryId: "internet",
        allocationKey: "fixed",
        rateCents: null,
        fixedAmountCents: 500,
      },
      {
        serviceCategoryId: "vytah",
        allocationKey: "flat_count_equal",
        rateCents: 1000,
        fixedAmountCents: null,
      },
    ],
    months: [1],
  });
  const fixed = rows.filter((r) => r.serviceCategoryId === "internet");
  check(
    "fixed: every unit pays the fixed amount",
    fixed.every((r) => r.amountCents === 500)
  );
  const equal = rows.filter((r) => r.serviceCategoryId === "vytah");
  check(
    "equal: sums to rate",
    equal.reduce((s, r) => s + r.amountCents, 0) === 1000
  );
  check(
    "equal: parts within 1 cent",
    equal.every((r) => Math.abs(r.amountCents - 1000 / 3) <= 1)
  );
}

console.log("computeAssessments: publish preconditions");
throws(
  "missing VS throws with unit id",
  () =>
    computeAssessments({
      units: [{ ...units[0], vs: "" }],
      services: [
        {
          serviceCategoryId: "fpuo",
          allocationKey: "share",
          rateCents: 100,
          fixedAmountCents: null,
        },
      ],
      months: [1],
    }),
  "without VS"
);
throws(
  "missing share throws",
  () =>
    computeAssessments({
      units: [{ ...units[0], shareNumerator: null }],
      services: [
        {
          serviceCategoryId: "fpuo",
          allocationKey: "share",
          rateCents: 100,
          fixedAmountCents: null,
        },
      ],
      months: [1],
    }),
  "ownership share"
);
throws(
  "missing area throws",
  () =>
    computeAssessments({
      units: [{ ...units[0], areaM2: null }],
      services: [
        {
          serviceCategoryId: "up",
          allocationKey: "area_m2",
          rateCents: 100,
          fixedAmountCents: null,
        },
      ],
      months: [1],
    }),
  "no area"
);
throws(
  "zero persons month throws (weight sum 0)",
  () =>
    computeAssessments({
      units: [{ ...units[0], personsByMonth: { 1: 0 } }],
      services: [
        {
          serviceCategoryId: "voda",
          allocationKey: "persons",
          rateCents: 100,
          fixedAmountCents: null,
        },
      ],
      months: [1],
    }),
  "weight sum"
);
throws("no services throws", () =>
  computeAssessments({ units, services: [], months: [1] })
);
throws("invalid month throws", () =>
  computeAssessments({
    units,
    services: [
      {
        serviceCategoryId: "fpuo",
        allocationKey: "share",
        rateCents: 100,
        fixedAmountCents: null,
      },
    ],
    months: [13],
  })
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll assessment checks passed.");

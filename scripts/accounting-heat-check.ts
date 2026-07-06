/**
 * BYT-20260512-002 heat/TÚV split check (vyhláška 269/2015 ve znění
 * 376/2021) — `pnpm test:accounting-heat`. Self-contained tsx, NO database.
 *
 * Guards modules/accounting/src/engine/heat.ts + the settlement hook that
 * consumes it. Reference values below are hand-computed from the split +
 * single-pass §4 correction; every case additionally asserts the ledger
 * invariant that matters: Σ per-unit cost === total service cost.
 *
 * NOTE: exact §4 conformance still needs an official MMR worked example
 * (see the engine's file caveat); these cases pin the split arithmetic,
 * the correction direction, and sum preservation.
 */
import { computeHeatSplit } from "@modules/accounting/src/engine/heat";
import { computeSettlement } from "@modules/accounting/src/engine/settlement";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sum = (r: { units: { finalCents: number }[] }) =>
  r.units.reduce((s, u) => s + u.finalCents, 0);
const fin = (r: { units: { unitId: string; finalCents: number }[] }, id: string) =>
  r.units.find((u) => u.unitId === id)!.finalCents;

// ── basic + consumption split, nothing out of band ─────────────────────
console.log("split, no correction");
{
  const r = computeHeatSplit(
    100000,
    [
      { unitId: "A", areaMilliM2: 50000, consumptionMilli: 50000 },
      { unitId: "B", areaMilliM2: 50000, consumptionMilli: 50000 },
    ],
    { basicSharePct: 40 }
  );
  check("basic 40% component", r.basicCostCents === 40000);
  check("consumption 60% component", r.consumptionCostCents === 60000);
  check("A basic 20000", r.units.find((u) => u.unitId === "A")!.basicCents === 20000);
  check("A consumption 30000", r.units.find((u) => u.unitId === "A")!.consumptionCents === 30000);
  check("equal split 50/50", fin(r, "A") === 50000 && fin(r, "B") === 50000);
  check("none corrected", r.units.every((u) => !u.corrected));
  check("sum preserved", sum(r) === 100000);
}

// ── −20% floor clamps a low consumer (2 units) ─────────────────────────
console.log("floor clamp");
{
  const r = computeHeatSplit(
    100000,
    [
      { unitId: "A", areaMilliM2: 50000, consumptionMilli: 90000 },
      { unitId: "B", areaMilliM2: 50000, consumptionMilli: 10000 },
    ],
    { basicSharePct: 0 }
  );
  // raw A=90000 (in band), B=10000 (<40000 floor). B→40000, A absorbs.
  check("B pulled up to −20% floor 40000", fin(r, "B") === 40000);
  check("A pays remainder 60000", fin(r, "A") === 60000);
  check("B flagged corrected", r.units.find((u) => u.unitId === "B")!.corrected);
  check("A not corrected", !r.units.find((u) => u.unitId === "A")!.corrected);
  check("sum preserved", sum(r) === 100000);
}

// ── mixed: two units floored, two in-band absorb ───────────────────────
console.log("floor clamp + in-band absorb");
{
  const r = computeHeatSplit(
    200000,
    [
      { unitId: "A", areaMilliM2: 50000, consumptionMilli: 70000 },
      { unitId: "B", areaMilliM2: 50000, consumptionMilli: 20000 },
      { unitId: "C", areaMilliM2: 50000, consumptionMilli: 5000 },
      { unitId: "D", areaMilliM2: 50000, consumptionMilli: 5000 },
    ],
    { basicSharePct: 50 }
  );
  // raw A95000 B45000 C30000 D30000; lo=40000. C,D→40000 (−20000 pool),
  // redistributed to A,B by cons 70000:20000 → A−15556, B−4444.
  check("C floored 40000", fin(r, "C") === 40000);
  check("D floored 40000", fin(r, "D") === 40000);
  check("A absorbs → 79444", fin(r, "A") === 79444);
  check("B absorbs → 40556", fin(r, "B") === 40556);
  check("C,D corrected; A,B not",
    r.units.find((u) => u.unitId === "C")!.corrected &&
      !r.units.find((u) => u.unitId === "A")!.corrected);
  check("sum preserved", sum(r) === 200000);
}

// ── +100% cap AND −20% floor both bind, pool nets to 0 ─────────────────
console.log("cap + floor, balanced");
{
  const units = [
    { unitId: "A", areaMilliM2: 40000, consumptionMilli: 150000 },
    { unitId: "B", areaMilliM2: 40000, consumptionMilli: 18000 },
    { unitId: "C", areaMilliM2: 40000, consumptionMilli: 18000 },
    { unitId: "D", areaMilliM2: 40000, consumptionMilli: 18000 },
    { unitId: "E", areaMilliM2: 40000, consumptionMilli: 18000 },
    { unitId: "F", areaMilliM2: 40000, consumptionMilli: 18000 },
  ];
  const r = computeHeatSplit(240000, units, { basicSharePct: 40 });
  // raw A=106000 (>80000 cap), B..F=26800 (<32000 floor). Cap frees 26000,
  // 5 floors consume 26000 → pool 0.
  check("A capped at +100% → 80000", fin(r, "A") === 80000);
  check("B..F floored at −20% → 32000",
    ["B", "C", "D", "E", "F"].every((id) => fin(r, id) === 32000));
  check("all corrected", r.units.every((u) => u.corrected));
  check("sum preserved", sum(r) === 240000);
}

// ── no readings → falls back to a pure area split ──────────────────────
console.log("zero-consumption fallback");
{
  const r = computeHeatSplit(
    100000,
    [
      { unitId: "A", areaMilliM2: 60000, consumptionMilli: 0 },
      { unitId: "B", areaMilliM2: 40000, consumptionMilli: 0 },
    ],
    { basicSharePct: 40 }
  );
  // both components split by area 60:40 → A60000, B40000; both in band.
  check("A by area 60000", fin(r, "A") === 60000);
  check("B by area 40000", fin(r, "B") === 40000);
  check("sum preserved", sum(r) === 100000);
}

// ── applyCorrection:false → raw passthrough ────────────────────────────
console.log("correction disabled");
{
  const r = computeHeatSplit(
    100000,
    [
      { unitId: "A", areaMilliM2: 50000, consumptionMilli: 90000 },
      { unitId: "B", areaMilliM2: 50000, consumptionMilli: 10000 },
    ],
    { basicSharePct: 0, applyCorrection: false }
  );
  check("raw A 90000 kept", fin(r, "A") === 90000);
  check("raw B 10000 kept", fin(r, "B") === 10000);
  check("nothing corrected", r.units.every((u) => !u.corrected));
  check("sum preserved", sum(r) === 100000);
}

// ── validation ─────────────────────────────────────────────────────────
console.log("validation");
{
  const one = [{ unitId: "A", areaMilliM2: 50000, consumptionMilli: 0 }];
  let threw = false;
  try {
    computeHeatSplit(-1, one, { basicSharePct: 40 });
  } catch {
    threw = true;
  }
  check("negative cost rejected", threw);

  threw = false;
  try {
    computeHeatSplit(1000, one, { basicSharePct: 140 });
  } catch {
    threw = true;
  }
  check("basicSharePct > 100 rejected", threw);

  threw = false;
  try {
    computeHeatSplit(1000, [{ unitId: "A", areaMilliM2: 0, consumptionMilli: 0 }], {
      basicSharePct: 40,
    });
  } catch {
    threw = true;
  }
  check("zero total area rejected", threw);
}

// ── settlement consumes the metered split via costShareByUnit ──────────
console.log("settlement integration");
{
  const res = computeSettlement({
    unitIds: ["A", "B"],
    services: [
      {
        serviceCategoryId: "SVC_HEAT",
        actualCostCents: 100000,
        prescribedByUnit: { A: 50000, B: 50000 },
        advancesByUnit: { A: 40000, B: 60000 },
        costShareByUnit: { A: 60000, B: 40000 }, // from computeHeatSplit
      },
    ],
  });
  const a = res.units.find((u) => u.unitEntityId === "A")!;
  const b = res.units.find((u) => u.unitEntityId === "B")!;
  check("A uses metered share 60000 (not prescribed 50/50)",
    a.services[0].costShareCents === 60000);
  check("A nedoplatok 20000 (60000−40000)", a.totalDifferenceCents === 20000);
  check("B preplatok −20000 (40000−60000)", b.totalDifferenceCents === -20000);

  let threw = false;
  try {
    computeSettlement({
      unitIds: ["A", "B"],
      services: [
        {
          serviceCategoryId: "SVC_HEAT",
          actualCostCents: 100000,
          prescribedByUnit: { A: 50000, B: 50000 },
          advancesByUnit: { A: 0, B: 0 },
          costShareByUnit: { A: 60000, B: 30000 }, // sums to 90000 ≠ 100000
        },
      ],
    });
  } catch {
    threw = true;
  }
  check("metered split that doesn't tie out is rejected", threw);
}

console.log(
  failures === 0
    ? "\nAll heat checks passed."
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);

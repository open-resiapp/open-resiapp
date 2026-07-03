/**
 * BYT-20260512-002 Phase 1 allocation-engine check
 * (run: `pnpm test:accounting-allocation`).
 *
 * No test runner is configured in this repo, so this is a self-contained
 * tsx script (same pattern as test:voting-golden). Exits non-zero on the
 * first failing section.
 *
 * Guards the domain invariants of modules/accounting/src/engine/allocation.ts
 * (docs/domain/accounting.md):
 *   - sum preservation: allocated parts + unallocated always equal the input
 *     (cents never appear or vanish — invariant 10)
 *   - no part ever exceeds its open amount, none goes negative
 *   - FIFO across months: no cent reaches month N+1 while month N has an
 *     uncovered open assessment
 *   - the spec's worked example reproduces exactly (100 € over a
 *     30/20/50/20 predpis → 25.00/16.67/41.67/16.66)
 */
import {
  splitProportional,
  allocatePayment,
  type OpenAssessment,
} from "@modules/accounting/src/engine/allocation";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sum(xs: { amountCents: number }[]) {
  return xs.reduce((s, x) => s + x.amountCents, 0);
}

// ── splitProportional ──────────────────────────────────

console.log("splitProportional: spec worked example");
{
  // Predpis 120 € = 30 FPÚO + 20 teplo + 50 voda + 20 výťah; payment 100 €.
  // Spec: 25.00 / 16.67 / 41.67 / 16.66 (last absorbs rounding).
  const split = splitProportional(10000, [
    { id: "fpuo", openCents: 3000 },
    { id: "teplo", openCents: 2000 },
    { id: "voda", openCents: 5000 },
    { id: "vytah", openCents: 2000 },
  ]);
  const byId = Object.fromEntries(split.map((s) => [s.id, s.amountCents]));
  check("fpuo = 25.00", byId.fpuo === 2500, `got ${byId.fpuo}`);
  check("teplo = 16.67", byId.teplo === 1667, `got ${byId.teplo}`);
  check("voda = 41.67", byId.voda === 4167, `got ${byId.voda}`);
  check("vytah = 16.66 (absorbs)", byId.vytah === 1666, `got ${byId.vytah}`);
  check("sum preserved", sum(split) === 10000, `got ${sum(split)}`);
}

console.log("splitProportional: exact coverage");
{
  const parts = [
    { id: "a", openCents: 3000 },
    { id: "b", openCents: 2000 },
  ];
  const split = splitProportional(5000, parts);
  check(
    "total == open sum → each part paid in full",
    split.every((s, i) => s.amountCents === parts[i].openCents)
  );
}

console.log("splitProportional: half-even rounding");
{
  // 1 cent over two equal parts: share = 0.5 → half-even rounds to 0,
  // last absorbs the full cent.
  const split = splitProportional(1, [
    { id: "a", openCents: 100 },
    { id: "b", openCents: 100 },
  ]);
  check("0.5 rounds to even (0)", split[0].amountCents === 0);
  check("last absorbs", split[1].amountCents === 1);
}

console.log("splitProportional: overallocation throws");
{
  let threw = false;
  try {
    splitProportional(101, [{ id: "a", openCents: 100 }]);
  } catch {
    threw = true;
  }
  check("total > open sum throws", threw);
}

console.log("splitProportional: property sweep (seeded)");
{
  // Deterministic LCG — reproducible without Math.random.
  let seed = 42;
  const rand = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed % max) + 1;
  };
  let violations = 0;
  for (let run = 0; run < 2000; run++) {
    const n = rand(6);
    const parts = Array.from({ length: n }, (_, i) => ({
      id: String(i),
      openCents: rand(100000),
    }));
    const openSum = parts.reduce((s, p) => s + p.openCents, 0);
    const total = rand(openSum);
    const split = splitProportional(total, parts);
    const ok =
      sum(split) === total &&
      split.every(
        (s, i) => s.amountCents >= 0 && s.amountCents <= parts[i].openCents
      );
    if (!ok) {
      violations++;
      if (violations === 1) {
        console.error(
          `    first violation: total=${total} parts=${JSON.stringify(parts)} split=${JSON.stringify(split)}`
        );
      }
    }
  }
  check("2000 runs: sum preserved, 0 <= part <= open", violations === 0);
}

// ── allocatePayment ────────────────────────────────────

const month = (
  id: string,
  m: number,
  slug: string,
  openCents: number,
  periodYear = 2026
): OpenAssessment => ({ id, periodYear, month: m, categorySlug: slug, openCents });

console.log("allocatePayment: full coverage + preplatok");
{
  const result = allocatePayment(
    15000,
    [month("a", 1, "FPUO", 3000), month("b", 1, "SVC_HEAT", 2000)],
    "proportional"
  );
  check("all open amounts covered", sum(result.allocations) === 5000);
  check("leftover parks as preplatok", result.unallocatedCents === 10000);
}

console.log("allocatePayment: FIFO across months");
{
  // 60 € against Jan (50 open) + Feb (50 open): Jan fully, Feb gets 10.
  const result = allocatePayment(
    6000,
    [
      month("feb", 2, "FPUO", 5000),
      month("jan", 1, "FPUO", 5000),
    ],
    "proportional"
  );
  const byId = Object.fromEntries(
    result.allocations.map((a) => [a.assessmentId, a.amountCents])
  );
  check("january settled first", byId.jan === 5000, `got ${byId.jan}`);
  check("february gets remainder", byId.feb === 1000, `got ${byId.feb}`);
  check("nothing unallocated", result.unallocatedCents === 0);
}

console.log("allocatePayment: FIFO across period years");
{
  // Dec 2025 is older than Jan 2026 despite higher month number.
  const result = allocatePayment(
    3000,
    [
      month("jan26", 1, "FPUO", 5000, 2026),
      month("dec25", 12, "FPUO", 5000, 2025),
    ],
    "proportional"
  );
  const byId = Object.fromEntries(
    result.allocations.map((a) => [a.assessmentId, a.amountCents])
  );
  check("december 2025 paid first", byId.dec25 === 3000, `got ${byId.dec25}`);
  check("january 2026 untouched", byId.jan26 === undefined);
}

console.log("allocatePayment: proportional within partial month");
{
  // Spec example embedded in a real month group.
  const result = allocatePayment(
    10000,
    [
      month("fpuo", 3, "FPUO", 3000),
      month("teplo", 3, "SVC_HEAT", 2000),
      month("voda", 3, "SVC_WATER_COLD", 5000),
      month("vytah", 3, "SVC_LIFT", 2000),
    ],
    "proportional"
  );
  const byId = Object.fromEntries(
    result.allocations.map((a) => [a.assessmentId, a.amountCents])
  );
  check("proportional split matches spec", byId.fpuo === 2500 && byId.teplo === 1667 && byId.voda === 4167 && byId.vytah === 1666);
}

console.log("allocatePayment: priority_ordered strategy");
{
  // Stanovy: služby first, FPÚO last. 40 € against 30 FPÚO + 20 teplo + 20 voda.
  const result = allocatePayment(
    4000,
    [
      month("fpuo", 1, "FPUO", 3000),
      month("teplo", 1, "SVC_HEAT", 2000),
      month("voda", 1, "SVC_WATER_COLD", 2000),
    ],
    "priority_ordered",
    ["SVC_HEAT", "SVC_WATER_COLD", "FPUO"]
  );
  const byId = Object.fromEntries(
    result.allocations.map((a) => [a.assessmentId, a.amountCents])
  );
  check("teplo paid in full first", byId.teplo === 2000, `got ${byId.teplo}`);
  check("voda paid in full second", byId.voda === 2000, `got ${byId.voda}`);
  check("fpuo gets nothing (exhausted)", byId.fpuo === undefined);
}

console.log("allocatePayment: priority_ordered — unlisted slug goes last");
{
  const result = allocatePayment(
    1000,
    [
      month("other", 1, "SVC_OTHER", 1000),
      month("heat", 1, "SVC_HEAT", 1000),
    ],
    "priority_ordered",
    ["SVC_HEAT"]
  );
  const byId = Object.fromEntries(
    result.allocations.map((a) => [a.assessmentId, a.amountCents])
  );
  check("listed category first", byId.heat === 1000);
  check("unlisted category unpaid", byId.other === undefined);
}

console.log("allocatePayment: guards");
{
  let threw = false;
  try {
    allocatePayment(0, [month("a", 1, "FPUO", 100)], "proportional");
  } catch {
    threw = true;
  }
  check("zero payment throws", threw);

  const result = allocatePayment(
    500,
    [month("zero", 1, "FPUO", 0), month("open", 1, "FPUO", 500)],
    "proportional"
  );
  check(
    "zero-open assessments excluded",
    result.allocations.length === 1 && result.allocations[0].assessmentId === "open"
  );
}

console.log("allocatePayment: property sweep (seeded)");
{
  let seed = 1337;
  const rand = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed % max) + 1;
  };
  const slugs = ["FPUO", "SVC_HEAT", "SVC_WATER_COLD", "SVC_LIFT"];
  let violations = 0;
  for (let run = 0; run < 2000; run++) {
    const assessments: OpenAssessment[] = [];
    const nMonths = rand(4);
    for (let m = 1; m <= nMonths; m++) {
      const nCats = rand(4);
      for (let c = 0; c < nCats; c++) {
        assessments.push(
          month(`${m}-${c}`, m, slugs[c % slugs.length], rand(50000))
        );
      }
    }
    const strategy = run % 2 === 0 ? "proportional" : "priority_ordered";
    const payment = rand(assessments.reduce((s, a) => s + a.openCents, 0) + 20000);
    const result = allocatePayment(payment, assessments, strategy, slugs);

    const openById = new Map(assessments.map((a) => [a.id, a.openCents]));
    const monthById = new Map(assessments.map((a) => [a.id, a.month]));
    const allocatedByMonth = new Map<number, number>();
    const openByMonth = new Map<number, number>();
    for (const a of assessments) {
      openByMonth.set(a.month, (openByMonth.get(a.month) ?? 0) + a.openCents);
    }
    for (const a of result.allocations) {
      const m = monthById.get(a.assessmentId)!;
      allocatedByMonth.set(m, (allocatedByMonth.get(m) ?? 0) + a.amountCents);
    }

    const sumOk = sum(result.allocations) + result.unallocatedCents === payment;
    const boundsOk = result.allocations.every(
      (a) => a.amountCents > 0 && a.amountCents <= openById.get(a.assessmentId)!
    );
    // FIFO: any month with allocations implies every OLDER month is fully covered.
    const months = [...openByMonth.keys()].sort((a, b) => a - b);
    let fifoOk = true;
    for (let i = 1; i < months.length; i++) {
      const newer = months[i];
      if ((allocatedByMonth.get(newer) ?? 0) > 0) {
        for (let j = 0; j < i; j++) {
          const older = months[j];
          if ((allocatedByMonth.get(older) ?? 0) < openByMonth.get(older)!) {
            fifoOk = false;
          }
        }
      }
    }

    if (!(sumOk && boundsOk && fifoOk)) {
      violations++;
      if (violations === 1) {
        console.error(
          `    first violation (run ${run}, ${strategy}): payment=${payment} sumOk=${sumOk} boundsOk=${boundsOk} fifoOk=${fifoOk}`
        );
      }
    }
  }
  check("2000 runs: sum + bounds + FIFO hold", violations === 0);
}

// ── result ─────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll allocation checks passed.");

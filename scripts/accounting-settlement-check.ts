/**
 * BYT-20260512-002 Phase 4 — settlement-engine check
 * (run: `pnpm test:accounting-settlement`).
 *
 * Guards the vyúčtovanie math (SK §7b / CZ §7 statement contents):
 *   - per service: Σ unit cost shares = actual cost, exactly
 *   - rozdiel = cost share − advances; signs per the domain convention
 *     (positive = nedoplatok, owner pays)
 *   - dom-wide: Σ differences = Σ actual costs − Σ advances
 *   - zero-prescription service falls back to an equal split
 */
import { computeSettlement } from "@modules/accounting/src/engine/settlement";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const unitIds = ["u1", "u2", "u3"];

console.log("worked example");
{
  // Heat: prescribed 600/300/100 (Σ 1000 €), advances paid 600/250/100,
  // actual cost 1100 € → shares 660/330/110.
  // Cleaning: prescribed 120/120/120, all paid, actual 300 € → 100 each.
  const result = computeSettlement({
    unitIds,
    services: [
      {
        serviceCategoryId: "heat",
        actualCostCents: 110000,
        prescribedByUnit: { u1: 60000, u2: 30000, u3: 10000 },
        advancesByUnit: { u1: 60000, u2: 25000, u3: 10000 },
        allocationKey: "meters",
      },
      {
        serviceCategoryId: "cleaning",
        actualCostCents: 30000,
        prescribedByUnit: { u1: 12000, u2: 12000, u3: 12000 },
        advancesByUnit: { u1: 12000, u2: 12000, u3: 12000 },
      },
    ],
  });

  const u1 = result.units.find((u) => u.unitEntityId === "u1")!;
  const heat1 = u1.services.find((s) => s.serviceCategoryId === "heat")!;
  check("heat share proportional (660)", heat1.costShareCents === 66000);
  check("heat rozdiel u1 = +60", heat1.differenceCents === 6000);
  const clean1 = u1.services.find((s) => s.serviceCategoryId === "cleaning")!;
  check("cleaning share 100", clean1.costShareCents === 10000);
  check("cleaning rozdiel −20 (preplatok)", clean1.differenceCents === -2000);
  check("allocationKey passes through (AC 442)", heat1.allocationKey === "meters");
  check("allocationKey null when unset", clean1.allocationKey === null);
  check(
    "u1 total difference +40",
    u1.totalDifferenceCents === 4000,
    String(u1.totalDifferenceCents)
  );

  const u2 = result.units.find((u) => u.unitEntityId === "u2")!;
  check(
    "u2 heat rozdiel = 330−250 = +80",
    u2.services[0].differenceCents === 8000
  );

  for (const service of ["heat", "cleaning"]) {
    const sum = result.units.reduce(
      (s, u) =>
        s +
        u.services.find((l) => l.serviceCategoryId === service)!
          .costShareCents,
      0
    );
    const actual = result.perService.find(
      (p) => p.serviceCategoryId === service
    )!.actualCostCents;
    check(`Σ ${service} shares = actual cost`, sum === actual);
  }

  // Dom-wide identity: Σ rozdiely = Σ costs − Σ advances.
  const totalCosts = 110000 + 30000;
  const totalAdvances = 60000 + 25000 + 10000 + 36000;
  check(
    "Σ differences = costs − advances",
    result.totalDifferenceCents === totalCosts - totalAdvances,
    String(result.totalDifferenceCents)
  );
}

console.log("sum preservation under awkward splits");
{
  // 100.01 € over prescriptions 1/1/1 — remainder cent must not vanish.
  const result = computeSettlement({
    unitIds,
    services: [
      {
        serviceCategoryId: "x",
        actualCostCents: 10001,
        prescribedByUnit: { u1: 1, u2: 1, u3: 1 },
        advancesByUnit: {},
      },
    ],
  });
  const sum = result.units.reduce(
    (s, u) => s + u.services[0].costShareCents,
    0
  );
  check("odd cent preserved", sum === 10001);
}

console.log("zero-prescription fallback");
{
  const result = computeSettlement({
    unitIds,
    services: [
      {
        serviceCategoryId: "surprise",
        actualCostCents: 9000,
        prescribedByUnit: {},
        advancesByUnit: {},
      },
    ],
  });
  const shares = result.units.map((u) => u.services[0].costShareCents);
  check(
    "equal split when nothing was prescribed",
    shares.every((s) => s === 3000)
  );
}

console.log("rejection");
try {
  computeSettlement({ unitIds: [], services: [] });
  failures++;
  console.error("  FAIL empty units — did not throw");
} catch {
  console.log("  ok  empty units throws");
}
try {
  computeSettlement({
    unitIds,
    services: [
      {
        serviceCategoryId: "neg",
        actualCostCents: -5,
        prescribedByUnit: {},
        advancesByUnit: {},
      },
    ],
  });
  failures++;
  console.error("  FAIL negative cost — did not throw");
} catch {
  console.log("  ok  negative cost throws");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll settlement checks passed.");

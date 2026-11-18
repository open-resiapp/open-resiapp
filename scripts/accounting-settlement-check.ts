/**
 * BYT-20260512-002 Phase 4 — settlement-engine check
 * (run: `pnpm test:accounting-settlement`).
 *
 * Guards the vyúčtovanie math (SK §7b / CZ §7 statement contents):
 *   - per service: Σ unit cost shares = actual cost, exactly
 *   - result = cost share − PRESCRIBED advances (the ledger basis);
 *     unpaid = prescribed − paid is reported apart, never in the result;
 *     signs per the domain convention (positive = nedoplatok, owner pays)
 *   - dom-wide: Σ results = Σ actual costs − Σ prescriptions
 *   - weightsByUnit (the service's real key) drives the split
 *   - zero-prescription service falls back to an equal split
 *   - statement ↔ ledger invariant flags any cent of drift
 */
import {
  checkSettlementAgainstLedger,
  checkSettlementEntry,
  computeSettlement,
} from "@modules/accounting/src/engine/settlement";

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
    "u2 heat result = 330−300 (prescribed) = +30",
    u2.services[0].differenceCents === 3000
  );
  check("u2 heat unpaid = 300−250 = 50", u2.services[0].unpaidCents === 5000);
  check("u2 total unpaid 50", u2.totalUnpaidCents === 5000);

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

  // Dom-wide identity: Σ results = Σ costs − Σ prescriptions.
  const totalCosts = 110000 + 30000;
  const totalPrescribed = 100000 + 36000;
  check(
    "Σ results = costs − prescriptions",
    result.totalDifferenceCents === totalCosts - totalPrescribed,
    String(result.totalDifferenceCents)
  );

  // Ledger invariant: matching ledger → no violations; one cent off → flagged.
  const ledgerOk = {
    costByCategory: { heat: 110000, cleaning: 30000 },
    prescribedByUnit: { u1: 72000, u2: 42000, u3: 22000 },
  };
  check(
    "invariant holds when the ledger ties out",
    checkSettlementAgainstLedger(result, ledgerOk).length === 0
  );
  const off = checkSettlementAgainstLedger(result, {
    ...ledgerOk,
    costByCategory: { heat: 110001, cleaning: 30000 },
  });
  check("invariant flags a 1-cent cost drift", off.some((v) => v.code === "COST_MISMATCH"));
  const offP = checkSettlementAgainstLedger(result, {
    ...ledgerOk,
    prescribedByUnit: { u1: 72000, u2: 42000, u3: 21999 },
  });
  check("invariant flags a prescription drift", offP.some((v) => v.code === "PRESCRIBED_MISMATCH"));
  const entryOk = checkSettlementEntry(result, {
    unitNetByUnit: Object.fromEntries(
      result.units.map((u) => [u.unitEntityId, u.totalDifferenceCents])
    ),
    costCreditByCategory: { heat: 110000, cleaning: 30000 },
  });
  check("entry check passes on a faithful posting", entryOk.length === 0);
}

console.log("cost split by the service's key (weightsByUnit)");
{
  // Lift by area: 50/30/20 m² — prescriptions deliberately skewed so the
  // test proves the key, not the predpis, drives the split.
  const result = computeSettlement({
    unitIds,
    services: [
      {
        serviceCategoryId: "lift",
        actualCostCents: 100000,
        prescribedByUnit: { u1: 10000, u2: 10000, u3: 10000 },
        advancesByUnit: {},
        weightsByUnit: { u1: 50, u2: 30, u3: 20 },
        allocationKey: "area_m2",
      },
    ],
  });
  const shares = result.units.map((u) => u.services[0].costShareCents);
  check("area split 500/300/200 €", shares.join() === "50000,30000,20000", shares.join());
  check(
    "awkward weights still sum to the cost",
    computeSettlement({
      unitIds,
      services: [
        {
          serviceCategoryId: "w",
          actualCostCents: 10001,
          prescribedByUnit: {},
          advancesByUnit: {},
          weightsByUnit: { u1: 1 / 3, u2: 1 / 3, u3: 1 / 3 },
        },
      ],
    }).units.reduce((s, u) => s + u.services[0].costShareCents, 0) === 10001
  );
  let threw = false;
  try {
    computeSettlement({
      unitIds,
      services: [
        {
          serviceCategoryId: "nobody",
          actualCostCents: 100,
          prescribedByUnit: {},
          advancesByUnit: {},
          weightsByUnit: { u1: 0, u2: 0, u3: 0 },
        },
      ],
    });
  } catch {
    threw = true;
  }
  check("zero key weights are rejected", threw);
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

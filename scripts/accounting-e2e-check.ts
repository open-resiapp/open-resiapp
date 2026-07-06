/**
 * Accounting end-to-end integration check — `pnpm test:accounting-e2e`.
 *
 * Drives the REAL server libs (the exact functions the API handlers wrap)
 * against the demo dom seeded by `pnpm demo:accounting`, so runtime bugs
 * the pure golden scripts can't reach surface here. Writes to the local
 * demo DB (leaving a realistically populated dom to click through);
 * refuses any non-localhost DATABASE_URL.
 *
 * Run order:  pnpm demo:accounting -- --bare  &&  pnpm test:accounting-e2e
 * (--bare: the check posts its OWN opening balance + predpis to exercise
 *  those paths; a non-bare seed pre-publishes a predpis and the publish
 *  step would then fail with "schedule already exists".)
 */
import "dotenv/config";
process.env.NEXTAUTH_SECRET ??= "e2e-demo-secret";

import { Pool } from "pg";
import { randomUUID } from "crypto";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { entities, users } from "@/db/schema";
import {
  feeSchedules,
  journalEntries,
  expenseAuthorisations,
} from "@modules/accounting/src/db/schema";
import {
  processApprovedFinancialEffects,
  getVotingImpacts,
} from "@modules/accounting/src/lib/voting-pipeline";
import { submitOpeningBalance } from "@modules/accounting/src/lib/opening-balance";
import {
  createFeeSchedule,
  updateFeeScheduleDraft,
  listServiceCategories,
  listUnitVs,
} from "@modules/accounting/src/lib/fee-schedules";
import { publishSchedule } from "@modules/accounting/src/lib/fee-schedule-publish";
import { createManualPayment } from "@modules/accounting/src/lib/payments";
import { getUnitLedger } from "@modules/accounting/src/lib/karta-bytu";
import {
  importNormalizedLines,
  listUnmatchedBankLines,
  dismissBankLine,
} from "@modules/accounting/src/lib/bank-import";
import { createExpense } from "@modules/accounting/src/lib/expenses";
import {
  uploadAttachment,
  listAttachments,
} from "@modules/accounting/src/lib/attachments";
import { getDashboardTiles } from "@modules/accounting/src/lib/dashboard";
import { getCashflowProjection } from "@modules/accounting/src/lib/projection";
import {
  getVyuctovaniePreview,
  publishVyuctovanie,
  getVyuctovaniePdfData,
} from "@modules/accounting/src/lib/vyuctovanie";
import {
  buildExportBundle,
  verifyExportBundle,
} from "@modules/accounting/src/lib/export";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("refusing to run: DATABASE_URL is not localhost");
  process.exit(2);
}

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const [dom] = await db
    .select({
      id: entities.id,
      country: sql<"sk" | "cz">`${entities.data}->>'country'`,
    })
    .from(entities)
    .where(sql`${entities.data}->>'marker' = '__accounting_demo__'`)
    .limit(1);
  if (!dom) {
    console.error("no demo dom — run `pnpm demo:accounting` first");
    process.exit(2);
  }
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@test.sk"));
  const actorId = admin.id;
  const country = dom.country;
  const year = new Date().getUTCFullYear();

  const unitList = await listUnitVs(dom.id);
  check("4 demo units listed", unitList.length === 4, String(unitList.length));
  const byt101 = unitList.find((u) => u.flatNumber === "101")!;

  // ── opening balance (idempotent guard means re-run is a no-op) ──
  console.log("opening balance");
  try {
    await submitOpeningBalance({
      entityId: dom.id,
      country,
      year,
      createdById: actorId,
      bankaCents: 500000,
      pokladnicaCents: 20000,
      unitBalances: unitList.map((u) => ({
        unitEntityId: u.unitEntityId,
        fpuoCents: 100000,
        zalohyCents: 30000,
      })),
    });
    check("opening balance posted", true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check("opening balance (already posted ok)", msg.includes("already posted"), msg);
  }

  // ── predpis: create → services → publish ──
  console.log("predpis publish");
  const cats = await listServiceCategories(country);
  const fpuo = cats.find((c) => c.slug === "FPUO")!;
  const lift = cats.find((c) => c.slug === "SVC_LIFT")!;

  const { id: scheduleId } = await createFeeSchedule({
    entityId: dom.id,
    year,
    effectiveFrom: new Date(Date.UTC(year, 0, 1)),
    createdById: actorId,
  });
  await updateFeeScheduleDraft({
    entityId: dom.id,
    country,
    scheduleId,
    actorId,
    services: [
      { serviceCategoryId: fpuo.id, allocationKey: "share", rateCents: 30000, fixedAmountCents: null },
      { serviceCategoryId: lift.id, allocationKey: "flat_count_equal", rateCents: 4000, fixedAmountCents: null },
    ],
  });
  const pub = await publishSchedule({
    entityId: dom.id,
    country,
    scheduleId,
    actorId,
  });
  check(
    "publish generates 12 months × 2 svc × 4 units = 96 assessments",
    pub.assessmentCount === 96,
    String(pub.assessmentCount)
  );
  check("elapsed months posted", pub.postedMonths.length >= 1);

  // ── payment → karta balance ──
  console.log("payment + karta");
  const before = await getUnitLedger(dom.id, byt101.unitEntityId, country);
  const payRes = await createManualPayment({
    entityId: dom.id,
    country,
    createdById: actorId,
    unitEntityId: byt101.unitEntityId,
    amountCents: 20000,
    receivedAt: new Date(),
    method: "bank",
  });
  check("payment allocates or parks", payRes.allocatedCents + payRes.unallocatedCents === 20000);
  const after = await getUnitLedger(dom.id, byt101.unitEntityId, country);
  check(
    "karta balance drops by payment",
    (after?.balanceCents ?? 0) === (before?.balanceCents ?? 0) - 20000,
    `${before?.balanceCents} → ${after?.balanceCents}`
  );

  // ── reconciliation: import an unmatchable line → dismiss it (AC 439) ──
  console.log("reconciliation dismiss");
  await importNormalizedLines({
    entityId: dom.id,
    country,
    actorId,
    source: "bank_import",
    lines: [
      {
        externalTxId: `E2E-BANKFEE-${Date.now()}`,
        amountCents: 137,
        direction: "credit",
        bookingDate: new Date().toISOString().slice(0, 10),
        valueDate: null,
        // No VS, unknown IBAN/name → cannot auto-match → lands in the queue.
        vs: null,
        ss: null,
        ks: null,
        counterpartyIban: null,
        counterpartyName: "Banka — úrok",
        narrative: "Kreditný úrok",
      },
    ],
  });
  const unmatchedBefore = await listUnmatchedBankLines(dom.id);
  const toDismiss = unmatchedBefore.find((l) => l.amountCents === 137);
  check("unmatchable line lands in reconciliation queue", !!toDismiss);
  await dismissBankLine({
    entityId: dom.id,
    paymentId: toDismiss!.paymentId,
    actorId,
    reason: "bankový úrok, nie platba vlastníka",
  });
  const unmatchedAfter = await listUnmatchedBankLines(dom.id);
  check(
    "dismissed line leaves the queue",
    !unmatchedAfter.some((l) => l.paymentId === toDismiss!.paymentId)
  );

  // ── expense → dashboard tiles ──
  console.log("expense + dashboard");
  const { expenseId: firstExpenseId } = await createExpense({
    entityId: dom.id,
    country,
    createdById: actorId,
    supplierName: "Výťahy s.r.o.",
    supplierIco: "36000123",
    supplierIban: "SK9611000000002918599669",
    invoiceNo: `E2E-${Date.now()}`,
    invoiceDate: new Date(),
    serviceCategoryId: lift.id,
    okruh: "svc",
    amountCents: 15000,
    amountNettoCents: 12500,
    dphCents: 2500,
  });
  // Attach a scan (the mandatory-at-create path, AC 440 — the create route
  // wires exactly these two calls; a 1×1 PNG proves the storage driver works
  // in this environment). listAttachments must then return it.
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAgB2Bg8gAAAAAElFTkSuQmCC",
    "base64"
  );
  await uploadAttachment({
    entityId: dom.id,
    expenseId: firstExpenseId,
    role: "original",
    fileName: "invoice.png",
    contentType: "image/png",
    body: pngBytes,
    actorId,
  });
  const attachments = await listAttachments(dom.id, firstExpenseId);
  check("invoice scan attaches to expense (440)", attachments.length === 1);
  // Two revízie in distinct REVIZIA_* categories (listRevisions keeps the
  // latest inspection per category) — one overdue, one due within 60 days —
  // so the dashboard attention list surfaces both (AC 470).
  const revElectrical = cats.find((c) => c.slug === "REVIZIA_ELECTRICAL")!;
  const revGas = cats.find((c) => c.slug === "REVIZIA_GAS")!;
  const DAY = 24 * 3600 * 1000;
  await createExpense({
    entityId: dom.id,
    country,
    createdById: actorId,
    supplierName: "Revízie Elektro s.r.o.",
    supplierIco: "36000456",
    supplierIban: "SK9611000000002918599669",
    invoiceNo: `E2E-REV-OVERDUE-${Date.now()}`,
    invoiceDate: new Date(Date.now() - 400 * DAY),
    serviceCategoryId: revElectrical.id,
    okruh: "svc",
    amountCents: 6000,
    amountNettoCents: 5000,
    dphCents: 1000,
    nextInspectionDueAt: new Date(Date.now() - 5 * DAY),
  });
  await createExpense({
    entityId: dom.id,
    country,
    createdById: actorId,
    supplierName: "Revízie Plyn s.r.o.",
    supplierIco: "36000789",
    supplierIban: "SK9611000000002918599669",
    invoiceNo: `E2E-REV-SOON-${Date.now()}`,
    invoiceDate: new Date(Date.now() - 300 * DAY),
    serviceCategoryId: revGas.id,
    okruh: "svc",
    amountCents: 6000,
    amountNettoCents: 5000,
    dphCents: 1000,
    nextInspectionDueAt: new Date(Date.now() + 30 * DAY),
  });
  const tiles = await getDashboardTiles(dom.id, country);
  check("dashboard tiles compute", typeof tiles.bankaCents === "number");
  check("fond opráv tile present", typeof tiles.fondOpravCents === "number");
  check("nedoplatky counted", tiles.nedoplatky.count >= 0);
  check("overdue revízia escalated (470)", tiles.attention.revisionsOverdue >= 1);
  check("revízia due ≤60d surfaced (470)", tiles.attention.revisionsDueSoon >= 1);

  // ── projection: per pool + recurring expense (AC 484/486) ──
  console.log("cash-flow projection");
  await createExpense({
    entityId: dom.id,
    country,
    createdById: actorId,
    supplierName: "Upratovanie s.r.o.",
    supplierIco: "36000321",
    supplierIban: "SK9611000000002918599669",
    invoiceNo: `E2E-RECUR-${Date.now()}`,
    invoiceDate: new Date(),
    serviceCategoryId: lift.id,
    okruh: "svc",
    amountCents: 12000,
    amountNettoCents: 10000,
    dphCents: 2000,
    isRecurring: true,
  });
  const projection = await getCashflowProjection(dom.id, country);
  check("projection returns two pools (484)", projection.pools.length === 2);
  const svcPool = projection.pools.find((p) => p.pool === "svc")!;
  check(
    "recurring expense feeds služby outflow (486)",
    svcPool.months.every((m) => m.expenseCents >= 12000)
  );
  check(
    "total ties out to Σ pools (no drift)",
    projection.months.every(
      (m, i) =>
        m.closingCents ===
        projection.pools.reduce((s, p) => s + p.months[i].closingCents, 0)
    )
  );

  // ── vyúčtovanie preview (current year — gate blocks publish) ──
  console.log("vyúčtovanie preview");
  const preview = await getVyuctovaniePreview(dom.id, country, year);
  check("current-year publish blocked (not elapsed)", preview.gates.canPublish === false);
  check("gates computed", typeof preview.gates.unmatchedBankLines === "number");

  // ── prior-year settlement: publish + PDF (full wired close) ──
  console.log("prior-year vyúčtovanie publish");
  const prevYear = year - 1;
  try {
    const { id: prevSchedule } = await createFeeSchedule({
      entityId: dom.id,
      year: prevYear,
      effectiveFrom: new Date(Date.UTC(prevYear, 0, 1)),
      createdById: actorId,
    });
    await updateFeeScheduleDraft({
      entityId: dom.id,
      country,
      scheduleId: prevSchedule,
      actorId,
      services: [
        { serviceCategoryId: lift.id, allocationKey: "flat_count_equal", rateCents: 4000, fixedAmountCents: null },
      ],
    });
    await publishSchedule({ entityId: dom.id, country, scheduleId: prevSchedule, actorId });
    // A services-okruh cost for the settled year.
    await createExpense({
      entityId: dom.id,
      country,
      createdById: actorId,
      supplierName: "Výťahy s.r.o.",
      supplierIco: "36000123",
      supplierIban: "SK9611000000002918599669",
      invoiceNo: `E2E-PREV-${Date.now()}`,
      invoiceDate: new Date(Date.UTC(prevYear, 5, 15)),
      serviceCategoryId: lift.id,
      okruh: "svc",
      amountCents: 60000,
      amountNettoCents: 50000,
      dphCents: 10000,
    });

    const prevPreview = await getVyuctovaniePreview(dom.id, country, prevYear);
    check("prior-year gates allow publish", prevPreview.gates.canPublish === true, JSON.stringify(prevPreview.gates));

    const settled = await publishVyuctovanie({ entityId: dom.id, country, year: prevYear, actorId });
    check("settlement published", !!settled.settlementId);

    const after = await getVyuctovaniePreview(dom.id, country, prevYear);
    check("period locked after publish", after.gates.periodStatus === "published");

    const pdf = await getVyuctovaniePdfData({
      entityId: dom.id,
      country,
      unitEntityId: byt101.unitEntityId,
      year: prevYear,
      beneficiaryName: "SVB Demo",
    });
    check("settlement PDF data reads frozen rows", pdf.lines.length >= 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Re-runs hit "already published" — treat as pass.
    check("prior-year settlement (idempotent)", msg.includes("published") || msg.includes("already"), msg);
  }

  // ── signed export round-trip ──
  console.log("signed export");
  const bundle = await buildExportBundle({
    entityId: dom.id,
    country,
    entityName: "SVB Demo",
    generatedById: actorId,
  });
  const verified = verifyExportBundle(bundle);
  check("export verifies", verified.valid);
  const tampered = bundle.replace(/"description":"[^"]*"/, '"description":"HACKED"');
  check("tampered export rejected", verifyExportBundle(tampered).valid === false);

  // ── voting→accounting pipeline (AC 513/514/515) ──
  console.log("voting→accounting pipeline");
  const rateItemId = randomUUID();
  const expenseItemId = randomUUID();
  const effects = [
    {
      votingId: randomUUID(),
      votingItemId: rateItemId,
      title: "Zvýšenie FPÚO",
      kind: "fpuo_rate_change" as const,
      // Deterministic effective month (Aug of the test year) so the draft
      // supersedes the Jan predpis and its months become due below — the
      // pipeline's own default is firstOfNextMonth, which drifts to next
      // year when the suite runs in December.
      params: { newRateCents: 35000, effectiveFrom: `${year}-08-01` },
    },
    {
      votingId: randomUUID(),
      votingItemId: expenseItemId,
      title: "Oprava strechy",
      kind: "expense_approval" as const,
      params: { amountCents: 50000, description: "Oprava strechy" },
    },
  ];
  const res1 = await processApprovedFinancialEffects({
    entityId: dom.id,
    country,
    actorId,
    effects,
  });
  check(
    "rate change → draft schedule created",
    res1.find((r) => r.votingItemId === rateItemId)?.outcome === "created"
  );
  check(
    "expense approval → authorisation created",
    res1.find((r) => r.votingItemId === expenseItemId)?.outcome === "created"
  );

  const res2 = await processApprovedFinancialEffects({
    entityId: dom.id,
    country,
    actorId,
    effects,
  });
  check(
    "re-dispatch is idempotent",
    res2.every((r) => r.outcome === "skipped_duplicate")
  );

  const [draft] = await db
    .select({
      id: feeSchedules.id,
      status: feeSchedules.status,
      origin: feeSchedules.originVotingItemId,
    })
    .from(feeSchedules)
    .where(eq(feeSchedules.originVotingItemId, rateItemId));
  check(
    "draft linked to voting item",
    draft?.origin === rateItemId && draft?.status === "draft"
  );

  // Publish as of year-end so the Aug–Dec months of the vote-originated
  // schedule are due and post now — that is what stamps votingResolutionId
  // onto their journal entries (AC 515). At real "now" a next-month-effective
  // schedule has posted nothing yet, so there would be no entry to inspect.
  await publishSchedule({
    entityId: dom.id,
    country,
    scheduleId: draft.id,
    actorId,
    now: new Date(Date.UTC(year, 11, 31)),
  });
  const [stamped] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, dom.id),
        eq(journalEntries.votingResolutionId, rateItemId)
      )
    );
  check("published assessments carry votingResolutionId (515)", (stamped?.c ?? 0) > 0);

  const [auth] = await db
    .select({ id: expenseAuthorisations.id })
    .from(expenseAuthorisations)
    .where(eq(expenseAuthorisations.votingItemId, expenseItemId));
  check("authorisation row exists", !!auth);
  await createExpense({
    entityId: dom.id,
    country,
    createdById: actorId,
    supplierName: "Strechy s.r.o.",
    supplierIco: "36000999",
    supplierIban: "SK9611000000002918599669",
    invoiceNo: `E2E-AUTH-${Date.now()}`,
    invoiceDate: new Date(),
    serviceCategoryId: lift.id,
    okruh: "svc",
    amountCents: 50000,
    amountNettoCents: 41667,
    dphCents: 8333,
    authorisationId: auth.id,
  });
  const [usedAuth] = await db
    .select({
      status: expenseAuthorisations.status,
      used: expenseAuthorisations.usedExpenseId,
    })
    .from(expenseAuthorisations)
    .where(eq(expenseAuthorisations.id, auth.id));
  check("authorisation marked used", usedAuth?.status === "used" && !!usedAuth.used);
  const [expStamp] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, dom.id),
        eq(journalEntries.votingResolutionId, expenseItemId),
        eq(journalEntries.sourceType, "expense")
      )
    );
  check("expense entry carries votingResolutionId (515)", (expStamp?.c ?? 0) > 0);

  const impacts = await getVotingImpacts(dom.id, [rateItemId, expenseItemId]);
  check(
    "impacts report draft + authorisation",
    impacts.length === 2 &&
      impacts.every((i) => i.feeScheduleDraft || i.expenseAuthorisation)
  );

  await (db.$client as Pool).end();
  if (failures > 0) {
    console.error(`\n${failures} e2e check(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll e2e checks passed — demo dom is populated and clickable.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

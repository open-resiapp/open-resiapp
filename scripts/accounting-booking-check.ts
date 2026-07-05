/**
 * BYT-20260512-002 booking-engine integration check
 * (run: `pnpm test:accounting-booking`).
 *
 * Runs against the LOCAL Postgres (docker compose up db + pnpm db:migrate)
 * — refuses any non-localhost DATABASE_URL. Everything executes inside a
 * single transaction that is ALWAYS rolled back: no rows survive, the
 * script is safe to run against a database with existing data.
 *
 * Guards the double-entry engine invariants (docs/domain/accounting.md):
 *   - opening balance: the 428 korekcia is derived so the entry balances
 *     by construction; invariant `banka + pokladnica = Σ fpúo + Σ zálohy
 *     + výsledok` holds
 *   - DB trigger (migration 0049) rejects unbalanced entries and entries
 *     with zero lines — verified with SET CONSTRAINTS IMMEDIATE
 *   - postAssessmentsForMonth is idempotent (second call = no-op)
 *   - payment posting debits banka for the FULL amount, parks the
 *     remainder on 379, and voidPayment's mirror restores every balance
 *   - a published period refuses postings
 */
import "dotenv/config";
import { sql, eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { entities, entityKinds, users } from "@/db/schema";
import {
  accounts,
  accountingPeriods,
  feeSchedules,
  feeAssessments,
  journalEntries,
  journalLines,
  payments,
  paymentAllocations,
  serviceCategories,
  settlements,
  settlementUnits,
  unitSettings,
} from "@modules/accounting/src/db/schema";
import {
  postOpeningBalance,
  postAssessmentsForMonth,
  postPaymentMatched,
  postSupplierInvoice,
  postSupplierPayment,
  postSettlementClose,
  applyPaymentCredit,
  voidPayment,
  assertPeriodOpen,
  expenseDebitCode,
  type Tx,
} from "@modules/accounting/src/engine/booking";
import { ACCOUNT_CODES } from "@modules/accounting/src/seeds/coa-sk";

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

/** Runs fn in a savepoint expecting it to throw; outer tx stays usable. */
async function expectThrow(
  tx: Tx,
  name: string,
  needle: string,
  fn: (inner: Tx) => Promise<void>
) {
  try {
    await tx.transaction(async (inner) => {
      await fn(inner);
    });
    failures++;
    console.error(`  FAIL ${name} — did not throw`);
  } catch (err) {
    // Drizzle wraps pg errors ("Failed query: …") with the real message in
    // the cause chain — collect every level before matching.
    const messages: string[] = [];
    let cursor: unknown = err;
    while (cursor instanceof Error) {
      messages.push(cursor.message);
      cursor = cursor.cause;
    }
    const combined = messages.join(" | ");
    if (combined.includes(needle)) console.log(`  ok  ${name}`);
    else {
      failures++;
      console.error(`  FAIL ${name} — wrong error: ${combined}`);
    }
  }
}

async function entryTotals(tx: Tx, entryId: string) {
  const [row] = await tx
    .select({
      debits: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
      credits: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(journalLines)
    .where(eq(journalLines.journalEntryId, entryId));
  return row;
}

async function accountBalance(tx: Tx, entityId: string, code: string) {
  const [row] = await tx
    .select({
      balance: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)::int`,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.entityId, entityId), eq(accounts.code, code)));
  return row.balance;
}

const ROLLBACK = new Error("__intentional_rollback__");

async function main() {
  try {
    await db.transaction(async (tx) => {
      // ── Scratch fixtures (rolled back at the end) ──
      await tx
        .insert(entityKinds)
        .values([
          { slug: "building", displayNameKey: "Kinds.building" },
          { slug: "unit", displayNameKey: "Kinds.unit" },
        ])
        .onConflictDoNothing();
      const [root] = await tx
        .insert(entities)
        .values({
          kind: "building",
          name: "__booking_check_dom",
          path: "/__booking_check",
          rootId: sql`gen_random_uuid()`,
        })
        .returning({ id: entities.id });
      await tx
        .update(entities)
        .set({ rootId: root.id })
        .where(eq(entities.id, root.id));
      const units = await tx
        .insert(entities)
        .values(
          [1, 2].map((n) => ({
            kind: "unit",
            name: `__booking_check_unit_${n}`,
            path: `/__booking_check/u${n}`,
            parentId: root.id,
            rootId: root.id,
            depth: 1,
          }))
        )
        .returning({ id: entities.id });
      const [actor] = await tx
        .insert(users)
        .values({ name: "__booking_check_user" })
        .returning({ id: users.id });
      const [period] = await tx
        .insert(accountingPeriods)
        .values({ entityId: root.id, year: 2099 })
        .returning({ id: accountingPeriods.id });

      const seededAccounts = await tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(eq(accounts.country, "sk"));
      check(
        "SK chart of accounts seeded (migration 0050)",
        seededAccounts.length >= 9,
        `found ${seededAccounts.length}`
      );

      // ── Opening balance ──
      console.log("opening balance");
      const obEntry = await postOpeningBalance(tx, {
        entityId: root.id,
        periodId: period.id,
        country: "sk",
        createdById: actor.id,
        asOf: new Date(Date.UTC(2099, 0, 1)),
        bankaCents: 100000,
        pokladnicaCents: 20000,
        unitBalances: [
          { unitEntityId: units[0].id, fpuoCents: 50000, zalohyCents: 30000 },
          // Negative = the unit OWES (opening nedoplatok → receivable).
          { unitEntityId: units[1].id, fpuoCents: -10000, zalohyCents: 0 },
        ],
      });
      const obTotals = await entryTotals(tx, obEntry);
      check("opening entry balances", obTotals.debits === obTotals.credits);
      // korekcia: assets 120000 + receivable 10000 (debit side 130000);
      // credits 80000 → 428 credit 50000.
      const korekcia = await accountBalance(
        tx,
        root.id,
        ACCOUNT_CODES.VYSLEDOK_MINULYCH_ROKOV
      );
      check("428 korekcia derived (-50000 = credit)", korekcia === -50000, String(korekcia));
      check(
        "banka balance 100000",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.BANKA)) === 100000
      );

      // ── DB trigger: unbalanced entry rejected ──
      console.log("DB balance trigger (migration 0049)");
      const [bankaAcc] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.country, "sk"), eq(accounts.code, ACCOUNT_CODES.BANKA)));
      await expectThrow(tx, "unbalanced entry rejected", "unbalanced", async (inner) => {
        const [entry] = await inner
          .insert(journalEntries)
          .values({
            entityId: root.id,
            periodId: period.id,
            postedAt: new Date(),
            description: "__unbalanced",
            sourceType: "manual",
            createdById: actor.id,
          })
          .returning({ id: journalEntries.id });
        await inner.insert(journalLines).values({
          journalEntryId: entry.id,
          accountId: bankaAcc.id,
          debitCents: 100,
          creditCents: 0,
          okruh: "fpuo",
        });
        await inner.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      });
      await expectThrow(tx, "zero-line entry rejected", "no lines", async (inner) => {
        await inner.insert(journalEntries).values({
          entityId: root.id,
          periodId: period.id,
          postedAt: new Date(),
          description: "__empty",
          sourceType: "manual",
          createdById: actor.id,
        });
        await inner.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      });

      // ── Predpis month posting + idempotency ──
      console.log("assessment posting");
      const categories = await tx
        .select({ id: serviceCategories.id, slug: serviceCategories.slug })
        .from(serviceCategories)
        .where(eq(serviceCategories.country, "sk"));
      const fpuoCat = categories.find((c) => c.slug === "FPUO")!;
      const liftCat = categories.find((c) => c.slug === "SVC_LIFT")!;

      await tx.insert(unitSettings).values([
        { entityId: root.id, unitEntityId: units[0].id, vs: "9901" },
        { entityId: root.id, unitEntityId: units[1].id, vs: "9902" },
      ]);
      const [schedule] = await tx
        .insert(feeSchedules)
        .values({
          entityId: root.id,
          periodId: period.id,
          effectiveFrom: new Date(Date.UTC(2099, 0, 1)),
          status: "published",
          publishedAt: new Date(),
          createdById: actor.id,
        })
        .returning({ id: feeSchedules.id });
      await tx.insert(feeAssessments).values(
        units.flatMap((u, i) => [
          {
            scheduleId: schedule.id,
            unitEntityId: u.id,
            serviceCategoryId: fpuoCat.id,
            periodId: period.id,
            month: 1,
            amountCents: 3000 + i * 1000,
            vs: `990${i + 1}`,
            allocationBasisSnapshot: {},
          },
          {
            scheduleId: schedule.id,
            unitEntityId: u.id,
            serviceCategoryId: liftCat.id,
            periodId: period.id,
            month: 1,
            amountCents: 500,
            vs: `990${i + 1}`,
            allocationBasisSnapshot: {},
          },
        ])
      );

      const firstPost = await postAssessmentsForMonth(tx, {
        entityId: root.id,
        periodId: period.id,
        scheduleId: schedule.id,
        country: "sk",
        createdById: actor.id,
        year: 2099,
        month: 1,
      });
      check("month posts an entry", firstPost !== null);
      const secondPost = await postAssessmentsForMonth(tx, {
        entityId: root.id,
        periodId: period.id,
        scheduleId: schedule.id,
        country: "sk",
        createdById: actor.id,
        year: 2099,
        month: 1,
      });
      check("second post is a no-op (idempotent)", secondPost === null);
      const monthTotals = await entryTotals(tx, firstPost!);
      check(
        "month entry balances at 8000 (3000+500+4000+500)",
        monthTotals.debits === 8000 && monthTotals.credits === 8000,
        `${monthTotals.debits}/${monthTotals.credits}`
      );

      // ── Payment with preplatok + void mirror ──
      console.log("payment posting + void");
      const balanceBefore = {
        banka: await accountBalance(tx, root.id, ACCOUNT_CODES.BANKA),
        fpuoRecv: await accountBalance(tx, root.id, ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO),
        parking: await accountBalance(tx, root.id, ACCOUNT_CODES.INE_ZAVAZKY),
      };
      const unitAssessments = await tx
        .select({ id: feeAssessments.id, serviceCategoryId: feeAssessments.serviceCategoryId, amountCents: feeAssessments.amountCents })
        .from(feeAssessments)
        .where(
          and(
            eq(feeAssessments.unitEntityId, units[0].id),
            eq(feeAssessments.serviceCategoryId, fpuoCat.id)
          )
        );
      const [payment] = await tx
        .insert(payments)
        .values({
          entityId: root.id,
          unitEntityId: units[0].id,
          source: "manual",
          method: "bank",
          receivedAt: new Date(),
          amountCents: 5000,
          vs: "9901",
          createdById: actor.id,
        })
        .returning({ id: payments.id });
      await postPaymentMatched(tx, {
        paymentId: payment.id,
        entityId: root.id,
        periodId: period.id,
        country: "sk",
        createdById: actor.id,
        allocatedBy: "auto",
        unitEntityId: units[0].id,
        allocations: [
          {
            assessmentId: unitAssessments[0].id,
            unitEntityId: units[0].id,
            serviceCategoryId: fpuoCat.id,
            okruh: "fpuo",
            amountCents: 3000,
          },
        ],
      });
      check(
        "banka debited FULL amount",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.BANKA)) ===
          balanceBefore.banka + 5000
      );
      check(
        "receivable credited by allocation",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO)) ===
          balanceBefore.fpuoRecv - 3000
      );
      check(
        "remainder parked on 379",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.INE_ZAVAZKY)) ===
          balanceBefore.parking - 2000
      );

      // Apply parked credit, then void — the mirror must reverse BOTH.
      await applyPaymentCredit(tx, {
        paymentId: payment.id,
        entityId: root.id,
        periodId: period.id,
        country: "sk",
        createdById: actor.id,
        unitEntityId: units[0].id,
        allocatedBy: "manual",
        allocations: [
          {
            assessmentId: unitAssessments[0].id,
            serviceCategoryId: fpuoCat.id,
            okruh: "fpuo",
            amountCents: 500,
          },
        ],
      });
      await expectThrow(
        tx,
        "credit application above remainder refuses",
        "exceeds parked remainder",
        async (inner) => {
          await applyPaymentCredit(inner, {
            paymentId: payment.id,
            entityId: root.id,
            periodId: period.id,
            country: "sk",
            createdById: actor.id,
            unitEntityId: units[0].id,
            allocatedBy: "manual",
            allocations: [
              {
                assessmentId: unitAssessments[0].id,
                serviceCategoryId: fpuoCat.id,
                okruh: "fpuo",
                amountCents: 99999,
              },
            ],
          });
        }
      );

      await voidPayment(tx, {
        paymentId: payment.id,
        entityId: root.id,
        periodId: period.id,
        country: "sk",
        actorId: actor.id,
        reason: "__check void",
      });
      check(
        "void restores banka",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.BANKA)) ===
          balanceBefore.banka
      );
      check(
        "void restores receivable",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO)) ===
          balanceBefore.fpuoRecv
      );
      check(
        "void restores 379 parking",
        (await accountBalance(tx, root.id, ACCOUNT_CODES.INE_ZAVAZKY)) ===
          balanceBefore.parking
      );
      await expectThrow(tx, "double void refuses", "already voided", async (inner) => {
        await voidPayment(inner, {
          paymentId: payment.id,
          entityId: root.id,
          periodId: period.id,
          country: "sk",
          actorId: actor.id,
          reason: "again",
        });
      });

      // ── Supplier expenses (Phase 3) ──
      console.log("supplier expenses");
      check(
        "fpuo expense debits the fund (472)",
        expenseDebitCode("fpuo", "SVC_OTHER") === ACCOUNT_CODES.ZAVAZKY_FPUO
      );
      check(
        "heat expense debits 502",
        expenseDebitCode("svc", "SVC_HEAT") === ACCOUNT_CODES.NAKLADY_ENERGIE
      );
      check(
        "lift expense debits 518",
        expenseDebitCode("svc", "SVC_LIFT") === ACCOUNT_CODES.NAKLADY_SLUZBY
      );
      {
        const fondBefore = -(await accountBalance(
          tx,
          root.id,
          ACCOUNT_CODES.ZAVAZKY_FPUO
        ));
        const invoiceEntry = await postSupplierInvoice(tx, {
          expenseId: root.id, // any uuid — surface row not needed here
          entityId: root.id,
          periodId: period.id,
          country: "sk",
          createdById: actor.id,
          okruh: "fpuo",
          categorySlug: null,
          serviceCategoryId: null,
          amountCents: 12000,
          description: "Faktúra oprava strechy",
        });
        const invTotals = await entryTotals(tx, invoiceEntry);
        check(
          "invoice entry balances",
          invTotals.debits === 12000 && invTotals.credits === 12000
        );
        const fondAfter = -(await accountBalance(
          tx,
          root.id,
          ACCOUNT_CODES.ZAVAZKY_FPUO
        ));
        check(
          "fpuo invoice draws the fund down",
          fondAfter === fondBefore - 12000,
          `${fondBefore} → ${fondAfter}`
        );
        check(
          "321 carries the payable",
          (await accountBalance(tx, root.id, ACCOUNT_CODES.DODAVATELIA)) ===
            -12000
        );

        const bankaBefore = await accountBalance(
          tx,
          root.id,
          ACCOUNT_CODES.BANKA
        );
        await postSupplierPayment(tx, {
          expenseId: root.id,
          entityId: root.id,
          periodId: period.id,
          country: "sk",
          createdById: actor.id,
          okruh: "fpuo",
          amountCents: 12000,
          method: "bank",
        });
        check(
          "payment clears 321",
          (await accountBalance(tx, root.id, ACCOUNT_CODES.DODAVATELIA)) === 0
        );
        check(
          "payment credits banka",
          (await accountBalance(tx, root.id, ACCOUNT_CODES.BANKA)) ===
            bankaBefore - 12000
        );
      }

      // ── Settlement close (vyúčtovanie reclassification) ──
      console.log("settlement close");
      {
        // Prescribed 100+80=180; costs 200; extras: u1 +30, u2 −10 → the
        // entry must balance (Dr 180+30 = Cr 200+10) or the deferred
        // trigger kills the tx.
        const entryId = await postSettlementClose(tx, {
          settlementId: root.id,
          entityId: root.id,
          periodId: period.id,
          country: "sk",
          createdById: actor.id,
          year: 2099,
          categoryCosts: [
            {
              serviceCategoryId: liftCat.id,
              categorySlug: "SVC_LIFT",
              costCents: 20000,
            },
          ],
          unitLines: [
            {
              unitEntityId: units[0].id,
              prescribedCents: 10000,
              costShareCents: 13000,
            },
            {
              unitEntityId: units[1].id,
              prescribedCents: 8000,
              costShareCents: 7000,
            },
          ],
        });
        check("settlement entry posts", entryId !== null);
        const totals = await entryTotals(tx, entryId!);
        check(
          "settlement entry balances (210/210)",
          totals.debits === 21000 && totals.credits === 21000,
          `${totals.debits}/${totals.credits}`
        );
        // u1 owes 30 more → receivable 311.200 debited with unit ref.
        const [extra] = await tx
          .select({
            debit: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
          })
          .from(journalLines)
          .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
          .where(
            and(
              eq(journalLines.journalEntryId, entryId!),
              eq(accounts.code, ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY),
              eq(journalLines.unitEntityId, units[0].id)
            )
          );
        check("nedoplatok lands on the unit's receivable", extra.debit === 3000);
      }

      // ── Settlement receivable is allocatable ──
      console.log("settlement receivable allocation");
      {
        const [settlement] = await tx
          .insert(settlements)
          .values({
            entityId: root.id,
            periodId: period.id,
            publishedById: actor.id,
          })
          .returning({ id: settlements.id });
        const [su] = await tx
          .insert(settlementUnits)
          .values({
            settlementId: settlement.id,
            unitEntityId: units[0].id,
            payload: [],
            totalCostCents: 20000,
            totalAdvancesCents: 0,
            totalDifferenceCents: 20000,
          })
          .returning({ id: settlementUnits.id });

        const svcRecvBefore = await accountBalance(
          tx,
          root.id,
          ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY
        );
        const [setPay] = await tx
          .insert(payments)
          .values({
            entityId: root.id,
            unitEntityId: units[0].id,
            source: "manual",
            method: "bank",
            receivedAt: new Date(),
            amountCents: 20000,
            createdById: actor.id,
          })
          .returning({ id: payments.id });
        await postPaymentMatched(tx, {
          paymentId: setPay.id,
          entityId: root.id,
          periodId: period.id,
          country: "sk",
          createdById: actor.id,
          allocatedBy: "auto",
          unitEntityId: units[0].id,
          allocations: [
            {
              settlementUnitId: su.id,
              unitEntityId: units[0].id,
              serviceCategoryId: null,
              okruh: "svc",
              amountCents: 20000,
            },
          ],
        });
        check(
          "settlement payment credits 311.200",
          (await accountBalance(
            tx,
            root.id,
            ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY
          )) ===
            svcRecvBefore - 20000
        );
        const [allocRow] = await tx
          .select({
            settlementUnitId: paymentAllocations.settlementUnitId,
            assessmentId: paymentAllocations.assessmentId,
          })
          .from(paymentAllocations)
          .where(eq(paymentAllocations.paymentId, setPay.id));
        check(
          "allocation row targets the settlement unit",
          allocRow.settlementUnitId === su.id && allocRow.assessmentId === null
        );
        await expectThrow(
          tx,
          "double-target allocation refuses",
          "exactly one target",
          async (inner) => {
            await postPaymentMatched(inner, {
              paymentId: setPay.id,
              entityId: root.id,
              periodId: period.id,
              country: "sk",
              createdById: actor.id,
              allocatedBy: "auto",
              unitEntityId: units[0].id,
              allocations: [
                {
                  assessmentId: su.id,
                  settlementUnitId: su.id,
                  unitEntityId: units[0].id,
                  serviceCategoryId: null,
                  okruh: "svc",
                  amountCents: 1,
                },
              ],
            });
          }
        );
      }

      // ── Period lock ──
      console.log("period immutability");
      await tx
        .update(accountingPeriods)
        .set({ status: "published" })
        .where(eq(accountingPeriods.id, period.id));
      await expectThrow(tx, "posting into published period refuses", "published", async (inner) => {
        await assertPeriodOpen(inner, period.id);
      });

      // Verify whole scratch ledger balances before rolling back.
      const [ledger] = await tx
        .select({
          debits: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
          credits: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::int`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .where(eq(journalEntries.entityId, root.id));
      check("whole scratch ledger balances", ledger.debits === ledger.credits);

      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll booking checks passed (transaction rolled back).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

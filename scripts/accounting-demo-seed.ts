/**
 * Accounting demo seed (BYT-20260512-002) — `pnpm demo:accounting`.
 *
 * Bootstraps a fully clickable SVB for hands-on testing of the accounting
 * module: one dom, 4 units with share/area, owner logins, an admin/
 * treasurer login, the accounting module enabled, and settings (IBAN +
 * due day) so predpis PDFs and PAY by square QR work out of the box.
 *
 * Refuses any non-localhost DATABASE_URL. Idempotent: wipes and re-seeds
 * only its own demo dom (by a marker in entities.data).
 *
 * Logins (all password Admin123!):
 *   admin@test.sk    — admin + treasurer (full write)
 *   jan@test.sk      — owner of byt 101
 *   maria@test.sk    — owner of byt 102
 */
import "dotenv/config";
process.env.NEXTAUTH_SECRET ??= "demo-seed-secret";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import {
  entities,
  entityKinds,
  users,
  memberships,
  boardMembers,
  coreModules,
} from "@/db/schema";
import {
  accountingSettings,
  unitSettings,
} from "@modules/accounting/src/db/schema";
import { submitOpeningBalance } from "@modules/accounting/src/lib/opening-balance";
import {
  createFeeSchedule,
  updateFeeScheduleDraft,
  listServiceCategories,
} from "@modules/accounting/src/lib/fee-schedules";
import { publishSchedule } from "@modules/accounting/src/lib/fee-schedule-publish";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("refusing to run: DATABASE_URL is not localhost");
  process.exit(2);
}

const MARKER = "__accounting_demo__";

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: { entities } });

  const hash = await bcrypt.hash("Admin123!", 10);
  const now = new Date();

  // Kinds.
  await db
    .insert(entityKinds)
    .values([
      { slug: "building", displayNameKey: "Kinds.building", allowsMembers: false },
      { slug: "unit", displayNameKey: "Kinds.unit", allowsMembers: true },
    ])
    .onConflictDoNothing();

  // Wipe a prior demo dom (children first via path prefix).
  const [existing] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(sql`${entities.data}->>'marker' = ${MARKER}`)
    .limit(1);
  if (existing) {
    const id = existing.id;
    // One transaction so the deferred journal-balance trigger sees each
    // entry AND its cascaded lines gone together at commit (deleting lines
    // alone would trip "entry has no lines"). journal_lines /
    // fee_schedule_services / payment_allocations cascade from their
    // parents — delete only parents, restrict-FK children before
    // journal_entries.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const w = (s: string) => client.query(s, [id]);
      await w(`delete from mod_accounting_notifications_sent where entity_id = $1`);
      await w(`delete from mod_accounting_payments where entity_id = $1`); // cascades allocations
      await w(`delete from mod_accounting_settlement_units where settlement_id in (select id from mod_accounting_settlements where entity_id = $1)`);
      await w(`delete from mod_accounting_settlements where entity_id = $1`);
      await w(`delete from mod_accounting_fee_assessments where schedule_id in (select id from mod_accounting_fee_schedules where entity_id = $1)`);
      // Attachments hold restrict FKs to BOTH entities and expenses, so they
      // must go before the expenses delete below. Authorisations hold a
      // restrict FK to entities (usedExpenseId → expenses is set null).
      await w(`delete from mod_accounting_expense_attachments where entity_id = $1`);
      await w(`delete from mod_accounting_expense_authorisations where entity_id = $1`);
      await w(`delete from mod_accounting_expenses where entity_id = $1`);
      await w(`delete from mod_accounting_journal_entries where entity_id = $1`); // cascades lines
      await w(`delete from mod_accounting_fee_schedules where entity_id = $1`); // cascades services
      await w(`delete from mod_accounting_meter_readings where entity_id = $1`);
      await w(`delete from mod_accounting_unit_persons where unit_entity_id in (select id from entities where root_id = $1)`);
      await w(`delete from mod_accounting_bank_connections where entity_id = $1`);
      await w(`delete from mod_accounting_audit_log where entity_id = $1`);
      await w(`delete from mod_accounting_periods where entity_id = $1`);
      await w(`delete from mod_accounting_unit_settings where entity_id = $1`);
      await w(`delete from mod_accounting_settings where entity_id = $1`);
      // Voting rows: the e2e závierka + voting→accounting pipeline checks
      // create real votings/voting_items on THIS dom (restrict FK to entities),
      // so they must be cleared before the entities delete below or re-seed
      // dies. Delete children → parents.
      // NB: ballots.entity_id is the UNIT entity, not the dom root — scope
      // the whole ballot family through votings (voting_id), same as below.
      await w(`delete from mod_voting_ballot_item_votes where ballot_id in (select b.id from mod_voting_ballots b join mod_voting_votings v on b.voting_id = v.id where v.entity_id = $1)`);
      await w(`delete from mod_voting_ballot_photos where ballot_id in (select b.id from mod_voting_ballots b join mod_voting_votings v on b.voting_id = v.id where v.entity_id = $1)`);
      await w(`delete from mod_voting_ballots where voting_id in (select id from mod_voting_votings where entity_id = $1)`);
      await w(`delete from mod_voting_mandates where voting_id in (select id from mod_voting_votings where entity_id = $1)`);
      await w(`delete from mod_voting_voting_items where voting_id in (select id from mod_voting_votings where entity_id = $1)`);
      await w(`delete from mod_voting_votings where entity_id = $1`);
      await w(`delete from board_members where entity_id = $1`);
      await w(`delete from memberships where entity_id in (select id from entities where root_id = $1)`);
      await w(`delete from entities where root_id = $1`);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    console.log("wiped prior demo dom");
  }

  // Users (email has a PARTIAL unique index — delete-then-insert avoids
  // the ON CONFLICT arbiter-predicate dance; safe on the demo DB).
  const demoEmails = [
    "admin@test.sk",
    "jan@test.sk",
    "maria@test.sk",
    "peter@test.sk",
  ];
  await pool.query(`delete from board_members where user_id in (
    select id from users where email = any($1))`, [demoEmails]);
  await pool.query(`delete from memberships where user_id in (
    select id from users where email = any($1))`, [demoEmails]);
  await pool.query(`delete from users where email = any($1)`, [demoEmails]);

  async function upsertUser(
    email: string,
    name: string,
    role: "admin" | "owner"
  ): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email, name, passwordHash: hash, role })
      .returning({ id: users.id });
    return u.id;
  }
  const adminId = await upsertUser("admin@test.sk", "Admin Správca", "admin");
  const janId = await upsertUser("jan@test.sk", "Ján Mrkvička", "owner");
  const mariaId = await upsertUser("maria@test.sk", "Mária Nováková", "owner");
  const peterId = await upsertUser("peter@test.sk", "Peter Novák", "owner");

  // Dom (root).
  const [dom] = await db
    .insert(entities)
    .values({
      kind: "building",
      name: "SVB Demo, Hlavná 1",
      path: "/svb-demo",
      depth: 0,
      rootId: sql`gen_random_uuid()`,
      data: {
        marker: MARKER,
        country: "sk",
        address: "Hlavná 1, 010 01 Žilina",
        ico: "36000001",
        template_slug: "housing_community",
      },
    })
    .returning({ id: entities.id });
  await db
    .update(entities)
    .set({ rootId: dom.id })
    .where(eq(entities.id, dom.id));

  // 4 units with share (Σ share = 1) + area + flat number.
  const unitDefs = [
    { flat: "101", num: 2800, den: 10000, area: 75.5, owner: janId, vs: "101" },
    { flat: "102", num: 2600, den: 10000, area: 68.0, owner: mariaId, vs: "102" },
    { flat: "103", num: 2400, den: 10000, area: 62.0, owner: peterId, vs: "103" },
    { flat: "104", num: 2200, den: 10000, area: 55.0, owner: null, vs: "104" },
  ];
  for (const u of unitDefs) {
    const [unit] = await db
      .insert(entities)
      .values({
        kind: "unit",
        name: `Byt ${u.flat}`,
        path: `/svb-demo/${u.flat}`,
        parentId: dom.id,
        rootId: dom.id,
        depth: 1,
        data: {
          flat_number: u.flat,
          floor: Number(u.flat[0]),
          share_numerator: u.num,
          share_denominator: u.den,
          area_m2: u.area,
        },
      })
      .returning({ id: entities.id });

    await db.insert(unitSettings).values({
      entityId: dom.id,
      unitEntityId: unit.id,
      vs: u.vs,
    });

    if (u.owner) {
      await db.insert(memberships).values({
        userId: u.owner,
        entityId: unit.id,
        role: "owner",
        status: "active",
      });
    }
  }

  // Admin is the treasurer (board role).
  await db.insert(boardMembers).values({
    entityId: dom.id,
    userId: adminId,
    role: "treasurer",
    electedAt: now,
    isActive: true,
  });

  // Enable the accounting module.
  await db
    .insert(coreModules)
    .values({
      name: "accounting",
      version: "0.1.0",
      status: "enabled",
      installPath: "modules/accounting",
    })
    .onConflictDoUpdate({
      target: coreModules.name,
      set: { status: "enabled" },
    });

  // Accounting settings — IBAN + due day so QR/PDF work.
  await db.insert(accountingSettings).values({
    entityId: dom.id,
    allocationStrategy: "proportional",
    bankIban: "SK9611000000002918599669",
    dueDay: 15,
    effectiveFrom: sql`now()`,
    createdById: adminId,
  });

  // Skip the live-books setup with --bare to test onboarding from scratch.
  const bare = process.argv.includes("--bare");
  if (!bare) {
    const year = new Date().getUTCFullYear();
    const unitRows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.rootId, dom.id), eq(entities.kind, "unit")));

    // Opening balance so the dom isn't blocked on onboarding.
    await submitOpeningBalance({
      entityId: dom.id,
      country: "sk",
      year,
      createdById: adminId,
      bankaCents: 500000,
      pokladnicaCents: 20000,
      unitBalances: unitRows.map((u) => ({
        unitEntityId: u.id,
        fpuoCents: 100000,
        zalohyCents: 30000,
      })),
    });

    // A published predpis so karta balances, PDFs and QR work immediately.
    const cats = await listServiceCategories("sk");
    const fpuo = cats.find((c) => c.slug === "FPUO")!;
    const lift = cats.find((c) => c.slug === "SVC_LIFT")!;
    const { id: scheduleId } = await createFeeSchedule({
      entityId: dom.id,
      year,
      effectiveFrom: new Date(Date.UTC(year, 0, 1)),
      createdById: adminId,
    });
    await updateFeeScheduleDraft({
      entityId: dom.id,
      country: "sk",
      scheduleId,
      actorId: adminId,
      services: [
        { serviceCategoryId: fpuo.id, allocationKey: "share", rateCents: 30000, fixedAmountCents: null },
        { serviceCategoryId: lift.id, allocationKey: "flat_count_equal", rateCents: 4000, fixedAmountCents: null },
      ],
    });
    await publishSchedule({ entityId: dom.id, country: "sk", scheduleId, actorId: adminId });
    console.log("posted opening balance + published a live predpis");
  }

  await pool.end();
  console.log(`
Demo dom ready: ${dom.id}
Logins (password Admin123!):
  admin@test.sk  — admin + treasurer
  jan@test.sk    — owner of byt 101
  maria@test.sk  — owner of byt 102

Next: pnpm dev → /sk/accounting
  1. Otváracia súvaha (opening balance) — or skip
  2. Predpis → new schedule → add services → publish
  3. Úhrady → record a payment
  4. Karta bytu → running balance + PDF
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

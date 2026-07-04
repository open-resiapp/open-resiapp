import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  check,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Accounting module schema (BYT-20260512-002, Phase 1 — Foundation).
// Domain invariants live in docs/domain/accounting.md — read it before
// touching this file. The ones that shape the schema:
//   - balances are always derived from postings, never stored
//   - nothing financial hard-deletes (void/archive only, 10-year retention)
//   - a published period is immutable; corrections post as reversals
//   - all financial records scope to the dom entity, never the SVB parent
// Σ debits = Σ credits per journal entry is enforced by a deferred
// constraint trigger (hand-written migration) — a row-level CHECK cannot
// span rows.
import { entities, users, countryEnum } from "@/db/schema";

// ── Enums ──────────────────────────────────────────────

export const periodStatusEnum = pgEnum("mod_accounting_period_status", [
  "open",
  "reconciling",
  "published",
  "closed",
]);

// mgmt = CZ-only okruh (příspěvek na vlastní správní činnost, §1180 ods. 2
// NOZ). Seeded now so Phase 6 needs no enum migration; unused for SK.
export const okruhEnum = pgEnum("mod_accounting_okruh", [
  "fpuo",
  "svc",
  "mgmt",
]);

// Extended in later phases (expense, vyuctovanie, …) — additive enum
// values only, never renames (project rule on enum migrations).
export const sourceTypeEnum = pgEnum("mod_accounting_source_type", [
  "opening_balance",
  "fee_schedule_publish",
  "payment",
  "manual",
]);

export const allocationKeyEnum = pgEnum("mod_accounting_allocation_key", [
  "share",
  "area_m2",
  "persons",
  "flat_count_equal",
  "fixed",
]);

export const allocationStrategyEnum = pgEnum(
  "mod_accounting_allocation_strategy",
  ["proportional", "priority_ordered"]
);

export const scheduleStatusEnum = pgEnum("mod_accounting_schedule_status", [
  "draft",
  "published",
]);

export const paymentSourceEnum = pgEnum("mod_accounting_payment_source", [
  "manual",
  "bank_import",
  "fio_api",
]);

export const allocatedByEnum = pgEnum("mod_accounting_allocated_by", [
  "auto",
  "manual",
]);

// Where the money physically arrived — drives the debit account on the
// payment posting (221 banka vs 211 pokladnica).
export const paymentMethodEnum = pgEnum("mod_accounting_payment_method", [
  "bank",
  "cash",
]);

// ── Settings ───────────────────────────────────────────

// Append-only: a strategy change inserts a new effective-from row, the
// history stays auditable. Current settings = latest effectiveFrom <= now.
export const accountingSettings = pgTable(
  "mod_accounting_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    allocationStrategy: allocationStrategyEnum("allocation_strategy")
      .notNull()
      .default("proportional"),
    // Ordered service_category slugs, only read for priority_ordered.
    priorityOrder: jsonb("priority_order"),
    // The dom's collection account — printed on predpis PDFs and encoded
    // into PAY by square QR. MOD-97-validated on write.
    bankIban: varchar("bank_iban", { length: 34 }),
    effectiveFrom: timestamp("effective_from").notNull(),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityEffectiveIdx: index("mod_accounting_settings_entity_idx").on(
      table.entityId,
      table.effectiveFrom
    ),
  })
);

// ── Periods ────────────────────────────────────────────

export const accountingPeriods = pgTable(
  "mod_accounting_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    year: integer("year").notNull(),
    status: periodStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    entityYearUnique: uniqueIndex("mod_accounting_periods_entity_year_idx").on(
      table.entityId,
      table.year
    ),
  })
);

// ── Chart of accounts (seed-only) ──────────────────────

// Loaded from per-country seed files (Opatrenie MF SR č. MF/24342/2007-74
// for SK; vyhláška 504/2002 Sb. for CZ in Phase 6). Never user-editable.
export const accounts = pgTable(
  "mod_accounting_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: countryEnum("country").notNull(),
    // Syntetický účet + optional analytic suffix, e.g. "221", "311.100".
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(), // asset | liability | equity | revenue | expense
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    countryCodeUnique: uniqueIndex("mod_accounting_accounts_country_code_idx").on(
      table.country,
      table.code
    ),
    kindCheck: check(
      "mod_accounting_accounts_kind_check",
      sql`${table.kind} IN ('asset', 'liability', 'equity', 'revenue', 'expense')`
    ),
  })
);

// ── Service categories (seed-only) ─────────────────────

export const serviceCategories = pgTable(
  "mod_accounting_service_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: countryEnum("country").notNull(),
    // FPUO, MGMT_CZ, SVC_HEAT, SVC_WATER_COLD, SVC_WATER_HOT,
    // SVC_ELECTRICITY_COMMON, SVC_LIFT, SVC_CLEANING, SVC_INTERNET, SVC_OTHER
    slug: varchar("slug", { length: 50 }).notNull(),
    okruh: okruhEnum("okruh").notNull(),
    // i18n key under Accounting.serviceCategories.* — display text never
    // hardcoded here.
    nameKey: varchar("name_key", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    countrySlugUnique: uniqueIndex(
      "mod_accounting_service_categories_country_slug_idx"
    ).on(table.country, table.slug),
  })
);

// ── Journal (double-entry core, hidden from default UI) ─

export const journalEntries = pgTable(
  "mod_accounting_journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    periodId: uuid("period_id")
      .references(() => accountingPeriods.id, { onDelete: "restrict" })
      .notNull(),
    postedAt: timestamp("posted_at").notNull(),
    description: text("description").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    // Back-link to the domain surface row (fee_schedule, payment, …) the
    // posting engine created this entry for. Nullable only for `manual`.
    sourceId: uuid("source_id"),
    // Set by the voting→accounting pipeline (Phase 7); nullable until then.
    votingResolutionId: uuid("voting_resolution_id"),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityPeriodIdx: index("mod_accounting_journal_entries_entity_period_idx").on(
      table.entityId,
      table.periodId
    ),
    sourceIdx: index("mod_accounting_journal_entries_source_idx").on(
      table.sourceType,
      table.sourceId
    ),
  })
);

export const journalLines = pgTable(
  "mod_accounting_journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalEntryId: uuid("journal_entry_id")
      .references(() => journalEntries.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "restrict" })
      .notNull(),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    okruh: okruhEnum("okruh").notNull(),
    // Set when the line concerns a specific unit (pohľadávka voči
    // vlastníkovi) — drives karta bytu drill-down.
    unitEntityId: uuid("unit_entity_id").references(() => entities.id, {
      onDelete: "restrict",
    }),
    serviceCategoryId: uuid("service_category_id").references(
      () => serviceCategories.id,
      { onDelete: "restrict" }
    ),
  },
  (table) => ({
    entryIdx: index("mod_accounting_journal_lines_entry_idx").on(
      table.journalEntryId
    ),
    unitIdx: index("mod_accounting_journal_lines_unit_idx").on(
      table.unitEntityId
    ),
    // Amounts are never signed (domain sign convention); exactly one side
    // of a line is non-zero. Entry-level balance is the deferred trigger.
    amountsCheck: check(
      "mod_accounting_journal_lines_amounts_check",
      sql`${table.debitCents} >= 0 AND ${table.creditCents} >= 0 AND (${table.debitCents} > 0) <> (${table.creditCents} > 0)`
    ),
  })
);

// ── Predpis (fee schedules) ────────────────────────────

export const feeSchedules = pgTable(
  "mod_accounting_fee_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    periodId: uuid("period_id")
      .references(() => accountingPeriods.id, { onDelete: "restrict" })
      .notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    // Null = open-ended; set when a mid-year revision supersedes this one.
    effectiveTo: timestamp("effective_to"),
    status: scheduleStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at"),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityPeriodIdx: index("mod_accounting_fee_schedules_entity_period_idx").on(
      table.entityId,
      table.periodId
    ),
  })
);

export const feeScheduleServices = pgTable(
  "mod_accounting_fee_schedule_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .references(() => feeSchedules.id, { onDelete: "cascade" })
      .notNull(),
    serviceCategoryId: uuid("service_category_id")
      .references(() => serviceCategories.id, { onDelete: "restrict" })
      .notNull(),
    allocationKey: allocationKeyEnum("allocation_key").notNull(),
    // Monthly rate for the whole dom, split per unit by allocationKey —
    // except `fixed`, which reads fixedAmountCents per unit instead.
    rateCents: integer("rate_cents"),
    fixedAmountCents: integer("fixed_amount_cents"),
  },
  (table) => ({
    scheduleCategoryUnique: uniqueIndex(
      "mod_accounting_fee_schedule_services_schedule_category_idx"
    ).on(table.scheduleId, table.serviceCategoryId),
    rateCheck: check(
      "mod_accounting_fee_schedule_services_rate_check",
      sql`(${table.allocationKey} = 'fixed' AND ${table.fixedAmountCents} IS NOT NULL) OR (${table.allocationKey} <> 'fixed' AND ${table.rateCents} IS NOT NULL)`
    ),
  })
);

// Derived row per (unit × service × month), generated at schedule publish.
// Immutable once the period locks. allocationBasisSnapshot freezes the
// inputs (share, area, persons count, owner user ids) at publish time —
// later changes to the unit never retro-alter published assessments, and
// debt follows the person recorded in the snapshot, not the current owner.
export const feeAssessments = pgTable(
  "mod_accounting_fee_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .references(() => feeSchedules.id, { onDelete: "restrict" })
      .notNull(),
    unitEntityId: uuid("unit_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    serviceCategoryId: uuid("service_category_id")
      .references(() => serviceCategories.id, { onDelete: "restrict" })
      .notNull(),
    periodId: uuid("period_id")
      .references(() => accountingPeriods.id, { onDelete: "restrict" })
      .notNull(),
    month: integer("month").notNull(), // 1-12
    amountCents: integer("amount_cents").notNull(),
    // Denormalized from unit settings at publish — the VS printed on the
    // predpis PDF and matched against incoming payments.
    vs: varchar("vs", { length: 10 }).notNull(),
    allocationBasisSnapshot: jsonb("allocation_basis_snapshot").notNull(),
    // Set when the month's obligation is posted to the journal (postings
    // happen per month as it becomes due, not all upfront at publish —
    // receivables must reflect only due obligations). Null = not yet due /
    // not yet posted; doubles as the posting idempotency marker and the
    // karta-bytu drill-down link.
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" }
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    unitPeriodIdx: index("mod_accounting_fee_assessments_unit_period_idx").on(
      table.unitEntityId,
      table.periodId
    ),
    scheduleUnitMonthUnique: uniqueIndex(
      "mod_accounting_fee_assessments_schedule_unit_svc_month_idx"
    ).on(table.scheduleId, table.unitEntityId, table.serviceCategoryId, table.month),
    monthCheck: check(
      "mod_accounting_fee_assessments_month_check",
      sql`${table.month} BETWEEN 1 AND 12`
    ),
  })
);

// ── Per-unit accounting config ─────────────────────────

export const unitSettings = pgTable(
  "mod_accounting_unit_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The dom the unit belongs to — lets us enforce VS uniqueness per dom.
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    unitEntityId: uuid("unit_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    // Variabilný symbol assigned to the unit — primary payment-matching
    // key. Numeric string, max 10 digits (SK/CZ bank standard).
    vs: varchar("vs", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    unitUnique: uniqueIndex("mod_accounting_unit_settings_unit_idx").on(
      table.unitEntityId
    ),
    entityVsUnique: uniqueIndex("mod_accounting_unit_settings_entity_vs_idx").on(
      table.entityId,
      table.vs
    ),
  })
);

// Time-versioned persons count per unit — input for the `persons`
// allocation key. Current value = latest effectiveFrom <= assessment month.
export const unitPersons = pgTable(
  "mod_accounting_unit_persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitEntityId: uuid("unit_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    personsCount: integer("persons_count").notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    unitEffectiveIdx: index("mod_accounting_unit_persons_unit_idx").on(
      table.unitEntityId,
      table.effectiveFrom
    ),
    personsCheck: check(
      "mod_accounting_unit_persons_count_check",
      sql`${table.personsCount} >= 0`
    ),
  })
);

// ── Payments ───────────────────────────────────────────

export const payments = pgTable(
  "mod_accounting_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    // The unit the payment belongs to. Set on manual entry and on matched
    // bank imports; null only for unmatched imports. Without it a fully
    // unallocated payment (pure preplatok) would lose its unit attribution
    // — the domain rule "preplatok parks on the unit" depends on this.
    unitEntityId: uuid("unit_entity_id").references(() => entities.id, {
      onDelete: "restrict",
    }),
    source: paymentSourceEnum("source").notNull(),
    method: paymentMethodEnum("method").notNull().default("bank"),
    receivedAt: timestamp("received_at").notNull(),
    valueDate: timestamp("value_date"),
    amountCents: integer("amount_cents").notNull(),
    vs: varchar("vs", { length: 10 }),
    ss: varchar("ss", { length: 10 }),
    ks: varchar("ks", { length: 4 }),
    counterpartyIban: varchar("counterparty_iban", { length: 34 }),
    counterpartyName: varchar("counterparty_name", { length: 255 }),
    narrative: text("narrative"),
    // Who decided the unit binding: a human (manual entry, reconciliation
    // confirm) or the matching engine. IBAN learning trusts only 'manual'
    // — auto-matches must never reinforce themselves. Null = unmatched.
    matchedBy: allocatedByEnum("matched_by"),
    // Bank-issued id (AcctSvcrRef / Fio ID operace) — import idempotency
    // key from Phase 2 on; null for manual entries.
    externalTxId: varchar("external_tx_id", { length: 100 }),
    rawPayload: jsonb("raw_payload"),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Posting link (Dr banka / Cr pohľadávky) — set when the payment is
    // matched and posted; posting idempotency marker + drill-down.
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" }
    ),
    // Void = correction path in an open period (never delete). Voiding
    // posts a reversal entry; allocation rows stay for history and are
    // excluded from balances via voidedAt IS NULL on the payment join.
    voidedAt: timestamp("voided_at"),
    voidedById: uuid("voided_by_id").references(() => users.id, { onDelete: "restrict" }),
    voidReason: text("void_reason"),
    voidJournalEntryId: uuid("void_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "restrict" }
    ),
  },
  (table) => ({
    // Entity-scoped: AcctSvcrRef is unique per BANK, not globally — two
    // doms at different banks can legitimately see the same reference.
    externalTxUnique: uniqueIndex("mod_accounting_payments_external_tx_idx")
      .on(table.entityId, table.externalTxId)
      .where(sql`${table.externalTxId} IS NOT NULL`),
    entityReceivedIdx: index("mod_accounting_payments_entity_received_idx").on(
      table.entityId,
      table.receivedAt
    ),
    amountCheck: check(
      "mod_accounting_payments_amount_check",
      sql`${table.amountCents} > 0`
    ),
  })
);

export const paymentAllocations = pgTable(
  "mod_accounting_payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .references(() => payments.id, { onDelete: "cascade" })
      .notNull(),
    assessmentId: uuid("assessment_id")
      .references(() => feeAssessments.id, { onDelete: "restrict" })
      .notNull(),
    amountCents: integer("amount_cents").notNull(),
    allocatedBy: allocatedByEnum("allocated_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    paymentIdx: index("mod_accounting_payment_allocations_payment_idx").on(
      table.paymentId
    ),
    assessmentIdx: index("mod_accounting_payment_allocations_assessment_idx").on(
      table.assessmentId
    ),
    amountCheck: check(
      "mod_accounting_payment_allocations_amount_check",
      sql`${table.amountCents} > 0`
    ),
  })
);

// ── Bank connections (outbound read tokens) ────────────

export const bankProviderEnum = pgEnum("mod_accounting_bank_provider", [
  "fio",
]);

// Per-dom live bank connections (Phase 2: Fio REST). The token is an
// OUTBOUND read-only credential we must present verbatim to the bank —
// unlike external_connections (inbound keys, stored hashed) it cannot be
// hashed. Protected by DB at-rest encryption + the treasurer-only API
// surface; never returned to clients (masked prefix only).
export const bankConnections = pgTable(
  "mod_accounting_bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    provider: bankProviderEnum("provider").notNull(),
    token: text("token").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncAt: timestamp("last_sync_at"),
    createdById: uuid("created_by_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityProviderUnique: uniqueIndex(
      "mod_accounting_bank_connections_entity_provider_idx"
    ).on(table.entityId, table.provider),
  })
);

// ── Audit log (append-only) ────────────────────────────

// Every mutation in the module writes a row here — insert, update, void.
// No update or delete path exists in code; retention is 10 years minimum
// (SK §35 zák. 431/2002). `justification` is required for manual journal
// entries and restricted-visibility decisions.
export const auditLog = pgTable(
  "mod_accounting_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    actorId: uuid("actor_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    action: varchar("action", { length: 50 }).notNull(), // insert | update | void | publish | lock | …
    tableName: varchar("table_name", { length: 100 }).notNull(),
    recordId: uuid("record_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    justification: text("justification"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityCreatedIdx: index("mod_accounting_audit_log_entity_created_idx").on(
      table.entityId,
      table.createdAt
    ),
    recordIdx: index("mod_accounting_audit_log_record_idx").on(
      table.tableName,
      table.recordId
    ),
  })
);

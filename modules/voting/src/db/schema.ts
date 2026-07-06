import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Module schema imports core symbols (entities, users) directly from
// the core schema. Phase 9.2 dropped the legacy entrances/flats tables;
// scope + share data live on entities + housing_unit_data now.
import { entities, users, documentProjects } from "@/db/schema";

// ── Enums ──────────────────────────────────────────────
// votingMethodEnum stays in core (it's a property of the housing root,
// not of voting records). Everything else moves with the module.

export const voteChoiceEnum = pgEnum("mod_voting_vote_choice", [
  "za",
  "proti",
  "zdrzal_sa",
]);

export const voteTypeEnum = pgEnum("mod_voting_vote_type", [
  "electronic",
  "paper",
]);

export const votingStatusEnum = pgEnum("mod_voting_voting_status", [
  "draft",
  "active",
  "closed",
]);

export const votingTypeEnum = pgEnum("mod_voting_voting_type", [
  "written",
  "meeting",
]);

export const votingInitiatedByEnum = pgEnum("mod_voting_voting_initiated_by", [
  "board",
  "owners_quarter",
]);

export const quorumTypeEnum = pgEnum("mod_voting_quorum_type", [
  "simple_present",
  "simple_all",
  "two_thirds_all",
  "all_unanimous",
]);

// A voting item may declare a financial effect that, once the item PASSES,
// the accounting module turns into a treasurer-reviewable draft (the
// voting↔accounting wedge, BYT-20260512-002 §Voting integration). Voting
// stays agnostic about the accounting specifics — it stores the kind + an
// opaque params blob and hands them to accounting on close.
export const financialEffectKindEnum = pgEnum(
  "mod_voting_financial_effect_kind",
  ["fpuo_rate_change", "expense_approval"]
);

// ── Tables ─────────────────────────────────────────────

export const votings = pgTable("mod_voting_votings", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: votingStatusEnum("status").notNull().default("draft"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  createdById: uuid("created_by_id")
    .references(() => users.id)
    .notNull(),
  votingType: votingTypeEnum("voting_type").notNull().default("written"),
  initiatedBy: votingInitiatedByEnum("initiated_by").notNull().default("board"),
  voteCounterId: uuid("vote_counter_id").references(() => users.id),
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "restrict" })
    .notNull(),
  // Optional linked document Project (dossier) — voters see its documents on
  // the voting detail. BYT-20260608-001 Phase C. Set null if the project is
  // deleted (cross-module FK to core document_projects).
  documentProjectId: uuid("document_project_id").references(
    () => documentProjects.id,
    { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mandates = pgTable(
  "mod_voting_mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    votingId: uuid("voting_id")
      .references(() => votings.id)
      .notNull(),
    fromOwnerId: uuid("from_owner_id")
      .references(() => users.id)
      .notNull(),
    fromEntityId: uuid("from_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    toOwnerId: uuid("to_owner_id")
      .references(() => users.id)
      .notNull(),
    paperDocumentConfirmed: boolean("paper_document_confirmed")
      .notNull()
      .default(false),
    verifiedByAdminId: uuid("verified_by_admin_id").references(() => users.id),
    verificationDate: timestamp("verification_date"),
    verificationNote: text("verification_note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    votingEntityIdx: uniqueIndex("mod_voting_mandates_voting_entity_idx").on(
      table.votingId,
      table.fromEntityId
    ),
  })
);

// ── Multi-item ballots (BYT-20260609-008) ──────────────
// Backfilled from the legacy single-question model in migration 0046; the
// legacy `mod_voting_votes` table + `votings.quorum_type` column were dropped
// in the cleanup migration 0047 once every reader/writer was switched over.

// One voting → many items (resolutions). Each item carries its OWN
// quorumType and produces its own result; the voting has no single
// pass/fail once this model is live.
export const votingItems = pgTable(
  "mod_voting_voting_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    votingId: uuid("voting_id")
      .references(() => votings.id, { onDelete: "cascade" })
      .notNull(),
    idx: integer("idx").notNull(), // display / ballot order
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    quorumType: quorumTypeEnum("quorum_type").notNull(), // MOVED from votings
    // Optional accounting effect — consumed by the accounting pipeline when
    // this item passes. Params shape depends on the kind:
    //   fpuo_rate_change → { newRateCents, effectiveFrom? (ISO date) }
    //   expense_approval → { amountCents, description?, categorySlug? }
    financialEffectKind: financialEffectKindEnum("financial_effect_kind"),
    financialEffectParams: jsonb("financial_effect_params"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    votingIdxUnique: uniqueIndex("mod_voting_voting_items_voting_idx").on(
      table.votingId,
      table.idx
    ),
  })
);

// The signed submission: one ballot per (voting, unit, owner-share). A
// single confirmation commits to ALL item choices via `ballotHash`.
// This uniqueness widens the legacy (votingId, entityId) recording key to
// per-share, realising the widening BYT-20260518-001 deferred.
export const ballots = pgTable(
  "mod_voting_ballots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    votingId: uuid("voting_id")
      .references(() => votings.id, { onDelete: "restrict" })
      .notNull(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(), // the unit
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(), // share-holder
    voteType: voteTypeEnum("vote_type").notNull().default("electronic"),
    // Counter / representative who recorded the ballot (soft link).
    recordedById: uuid("recorded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Representation link (BYT-20260609-004): a representative casts the
    // whole ballot under one mandate (mandate is per voting × owner).
    mandateId: uuid("mandate_id").references(() => mandates.id, {
      onDelete: "restrict",
    }),
    ballotHash: varchar("ballot_hash", { length: 64 }).notNull(), // commitment over all item choices
    signature: text("signature"), // passkey assertion (one, over ballotHash)
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
    disputed: boolean("disputed").notNull().default(false),
    disputeNote: text("dispute_note"),
  },
  (table) => ({
    votingEntityOwnerIdx: uniqueIndex(
      "mod_voting_ballots_voting_entity_owner_idx"
    ).on(table.votingId, table.entityId, table.ownerId),
  })
);

// One choice per item, under a ballot. `itemAuditHash` is secretless
// (Option B): sha256(votingId|itemId|entityId|ownerId|choice|recordedAt),
// no server secret — feeds audit-bundle leaves per docs/domain/voting.md.
export const ballotItemVotes = pgTable(
  "mod_voting_ballot_item_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ballotId: uuid("ballot_id")
      .references(() => ballots.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => votingItems.id, { onDelete: "restrict" })
      .notNull(),
    choice: voteChoiceEnum("choice").notNull(),
    itemAuditHash: varchar("item_audit_hash", { length: 64 }).notNull(),
  },
  (table) => ({
    ballotItemUnique: uniqueIndex(
      "mod_voting_ballot_item_votes_ballot_item_idx"
    ).on(table.ballotId, table.itemId),
  })
);

// Paper ballots carry ≥1 photo (multi-page paper → several photos). The
// "paper ⇒ ≥1 photo" rule is enforced in the app layer (cross-table, so
// not a single-row CHECK), replacing the legacy per-row photo check.
export const ballotPhotos = pgTable("mod_voting_ballot_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  ballotId: uuid("ballot_id")
    .references(() => ballots.id, { onDelete: "cascade" })
    .notNull(),
  storageKey: varchar("storage_key", { length: 1024 }).notNull(), // via src/lib/storage.ts
  idx: integer("idx").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Relations ──────────────────────────────────────────

export const votingsRelations = relations(votings, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [votings.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
  voteCounter: one(users, {
    fields: [votings.voteCounterId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [votings.entityId],
    references: [entities.id],
  }),
  mandates: many(mandates),
  items: many(votingItems),
  ballots: many(ballots),
}));

export const mandatesRelations = relations(mandates, ({ one }) => ({
  voting: one(votings, {
    fields: [mandates.votingId],
    references: [votings.id],
  }),
  fromOwner: one(users, {
    fields: [mandates.fromOwnerId],
    references: [users.id],
  }),
  fromEntity: one(entities, {
    fields: [mandates.fromEntityId],
    references: [entities.id],
  }),
  toOwner: one(users, {
    fields: [mandates.toOwnerId],
    references: [users.id],
  }),
}));

// ── Multi-item ballot relations (BYT-20260609-008) ─────

export const votingItemsRelations = relations(
  votingItems,
  ({ one, many }) => ({
    voting: one(votings, {
      fields: [votingItems.votingId],
      references: [votings.id],
    }),
    itemVotes: many(ballotItemVotes),
  })
);

export const ballotsRelations = relations(ballots, ({ one, many }) => ({
  voting: one(votings, {
    fields: [ballots.votingId],
    references: [votings.id],
  }),
  entity: one(entities, {
    fields: [ballots.entityId],
    references: [entities.id],
  }),
  owner: one(users, {
    fields: [ballots.ownerId],
    references: [users.id],
    relationName: "ballotOwner",
  }),
  recordedBy: one(users, {
    fields: [ballots.recordedById],
    references: [users.id],
    relationName: "ballotRecordedBy",
  }),
  mandate: one(mandates, {
    fields: [ballots.mandateId],
    references: [mandates.id],
  }),
  itemVotes: many(ballotItemVotes),
  photos: many(ballotPhotos),
}));

export const ballotItemVotesRelations = relations(
  ballotItemVotes,
  ({ one }) => ({
    ballot: one(ballots, {
      fields: [ballotItemVotes.ballotId],
      references: [ballots.id],
    }),
    item: one(votingItems, {
      fields: [ballotItemVotes.itemId],
      references: [votingItems.id],
    }),
  })
);

export const ballotPhotosRelations = relations(ballotPhotos, ({ one }) => ({
  ballot: one(ballots, {
    fields: [ballotPhotos.ballotId],
    references: [ballots.id],
  }),
}));

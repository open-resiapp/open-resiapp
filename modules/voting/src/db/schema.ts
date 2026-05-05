import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Module schema imports core symbols (entities, users, flats, entrances)
// directly from the core schema. This is allowed during the dual-run
// (RES-20260505-001 §"Code move and import contract") and replaced by
// SDK-mediated reads after the SDK delta on RES-20260428-002 lands.
import {
  entities,
  users,
  flats,
  entrances,
} from "@/db/schema";

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

// ── Tables ─────────────────────────────────────────────
// Tables retain their legacy names (`votings`, `votes`, `mandates`)
// during dual-run. VM-6 renames them to `mod_voting_*`.

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
  quorumType: quorumTypeEnum("quorum_type").notNull().default("simple_all"),
  voteCounterId: uuid("vote_counter_id").references(() => users.id),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  // Phase 4 dual-run: nullable until backfill completes; Phase 6 switches
  // reads/writes here; Phase 9 drops entranceId and makes this NOT NULL.
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const votes = pgTable(
  "mod_voting_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    votingId: uuid("voting_id")
      .references(() => votings.id)
      .notNull(),
    ownerId: uuid("owner_id")
      .references(() => users.id)
      .notNull(),
    flatId: uuid("flat_id")
      .references(() => flats.id)
      .notNull(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "restrict",
    }),
    choice: voteChoiceEnum("choice").notNull(),
    voteType: voteTypeEnum("vote_type").notNull().default("electronic"),
    recordedById: uuid("recorded_by_id").references(() => users.id),
    paperPhotoUrl: varchar("paper_photo_url", { length: 1000 }),
    auditHash: varchar("audit_hash", { length: 64 }).notNull(),
    disputed: boolean("disputed").notNull().default(false),
    disputeNote: text("dispute_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    votingFlatIdx: uniqueIndex("mod_voting_votes_voting_flat_idx").on(
      table.votingId,
      table.flatId
    ),
  })
);

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
    fromFlatId: uuid("from_flat_id")
      .references(() => flats.id)
      .notNull(),
    fromEntityId: uuid("from_entity_id").references(() => entities.id, {
      onDelete: "restrict",
    }),
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
    votingFlatIdx: uniqueIndex("mod_voting_mandates_voting_flat_idx").on(
      table.votingId,
      table.fromFlatId
    ),
  })
);

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
  entrance: one(entrances, {
    fields: [votings.entranceId],
    references: [entrances.id],
  }),
  votes: many(votes),
  mandates: many(mandates),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  voting: one(votings, {
    fields: [votes.votingId],
    references: [votings.id],
  }),
  owner: one(users, {
    fields: [votes.ownerId],
    references: [users.id],
  }),
  flat: one(flats, {
    fields: [votes.flatId],
    references: [flats.id],
  }),
  recordedBy: one(users, {
    fields: [votes.recordedById],
    references: [users.id],
  }),
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
  fromFlat: one(flats, {
    fields: [mandates.fromFlatId],
    references: [flats.id],
  }),
  toOwner: one(users, {
    fields: [mandates.toOwnerId],
    references: [users.id],
  }),
}));

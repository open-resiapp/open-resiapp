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

// Module schema imports core symbols (entities, users) directly from
// the core schema. Phase 9.2 dropped the legacy entrances/flats tables;
// scope + share data live on entities + housing_unit_data now.
import { entities, users } from "@/db/schema";

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
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "restrict" })
    .notNull(),
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
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
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
    votingEntityIdx: uniqueIndex("mod_voting_votes_voting_entity_idx").on(
      table.votingId,
      table.entityId
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
  entity: one(entities, {
    fields: [votes.entityId],
    references: [entities.id],
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
  fromEntity: one(entities, {
    fields: [mandates.fromEntityId],
    references: [entities.id],
  }),
  toOwner: one(users, {
    fields: [mandates.toOwnerId],
    references: [users.id],
  }),
}));

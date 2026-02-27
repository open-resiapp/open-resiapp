import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
]);

export const voteChoiceEnum = pgEnum("vote_choice", [
  "za",
  "proti",
  "zdrzal_sa",
]);

export const voteTypeEnum = pgEnum("vote_type", ["electronic", "paper"]);

export const votingStatusEnum = pgEnum("voting_status", [
  "draft",
  "active",
  "closed",
]);

export const postCategoryEnum = pgEnum("post_category", [
  "info",
  "urgent",
  "event",
  "maintenance",
]);

// ── Tables ─────────────────────────────────────────────

export const building = pgTable("building", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 500 }).notNull(),
  ico: varchar("ico", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entrances = pgTable("entrances", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id")
    .references(() => building.id)
    .notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  streetNumber: varchar("street_number", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const flats = pgTable("flats", {
  id: uuid("id").primaryKey().defaultRandom(),
  entranceId: uuid("entrance_id")
    .references(() => entrances.id)
    .notNull(),
  flatNumber: varchar("flat_number", { length: 20 }).notNull(),
  floor: integer("floor").notNull().default(0),
  shareNumerator: integer("share_numerator").notNull(),
  shareDenominator: integer("share_denominator").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    role: userRoleEnum("role").notNull().default("owner"),
    flatId: uuid("flat_id").references(() => flats.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const votings = pgTable("votings", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: votingStatusEnum("status").notNull().default("draft"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  createdById: uuid("created_by_id")
    .references(() => users.id)
    .notNull(),
  voteCounterId: uuid("vote_counter_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const votes = pgTable("votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  votingId: uuid("voting_id")
    .references(() => votings.id)
    .notNull(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  choice: voteChoiceEnum("choice").notNull(),
  voteType: voteTypeEnum("vote_type").notNull().default("electronic"),
  recordedById: uuid("recorded_by_id").references(() => users.id),
  paperPhotoUrl: varchar("paper_photo_url", { length: 1000 }),
  auditHash: varchar("audit_hash", { length: 64 }).notNull(),
  disputed: boolean("disputed").notNull().default(false),
  disputeNote: text("dispute_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  votingId: uuid("voting_id")
    .references(() => votings.id)
    .notNull(),
  fromOwnerId: uuid("from_owner_id")
    .references(() => users.id)
    .notNull(),
  toOwnerId: uuid("to_owner_id")
    .references(() => users.id)
    .notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  category: postCategoryEnum("category").notNull().default("info"),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  isPinned: boolean("is_pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 1000 }).notNull(),
  uploadedById: uuid("uploaded_by_id")
    .references(() => users.id)
    .notNull(),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Relations ──────────────────────────────────────────

export const buildingRelations = relations(building, ({ many }) => ({
  entrances: many(entrances),
}));

export const entrancesRelations = relations(entrances, ({ one, many }) => ({
  building: one(building, {
    fields: [entrances.buildingId],
    references: [building.id],
  }),
  flats: many(flats),
  posts: many(posts),
  documents: many(documents),
}));

export const flatsRelations = relations(flats, ({ one, many }) => ({
  entrance: one(entrances, {
    fields: [flats.entranceId],
    references: [entrances.id],
  }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  flat: one(flats, {
    fields: [users.flatId],
    references: [flats.id],
  }),
  votes: many(votes),
  createdVotings: many(votings, { relationName: "createdBy" }),
  posts: many(posts),
  documents: many(documents),
}));

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
  toOwner: one(users, {
    fields: [mandates.toOwnerId],
    references: [users.id],
  }),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
  entrance: one(entrances, {
    fields: [posts.entranceId],
    references: [entrances.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  uploadedBy: one(users, {
    fields: [documents.uploadedById],
    references: [users.id],
  }),
  entrance: one(entrances, {
    fields: [documents.entranceId],
    references: [entrances.id],
  }),
}));

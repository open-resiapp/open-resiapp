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
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
  "caretaker",
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

export const votingMethodEnum = pgEnum("voting_method", [
  "per_share",
  "per_flat",
  "per_area",
]);

export const votingTypeEnum = pgEnum("voting_type", ["written", "meeting"]);

export const votingInitiatedByEnum = pgEnum("voting_initiated_by", [
  "board",
  "owners_quarter",
]);

export const quorumTypeEnum = pgEnum("quorum_type", [
  "simple_present",
  "simple_all",
  "two_thirds_all",
  "all_unanimous",
]);

export const countryEnum = pgEnum("country", ["sk", "cz"]);

export const governanceModelEnum = pgEnum("governance_model", [
  "chairman_council",
  "committee",
  "chairman_only",
]);

export const boardMemberRoleEnum = pgEnum("board_member_role", [
  "chairman",
  "council_member",
  "committee_member",
  "committee_chairman",
]);

export const apiKeyPermissionEnum = pgEnum("api_key_permission", [
  "read",
  "read_write",
  "full",
]);

export const pairingStatusEnum = pgEnum("pairing_status", [
  "pending",
  "completed",
  "expired",
  "revoked",
  "locked",
]);

export const authResultEnum = pgEnum("auth_result", [
  "success",
  "invalid_key",
  "insufficient_permission",
  "rate_limited",
  "unauthenticated",
]);

export const consentTypeEnum = pgEnum("consent_type", [
  "data_processing",
  "communication",
]);

export const consentActionEnum = pgEnum("consent_action", [
  "granted",
  "withdrawn",
]);

export const communityPostTypeEnum = pgEnum("community_post_type", [
  "sale",
  "free",
  "borrow",
  "help_request",
  "help_offer",
  "event",
]);

export const communityPostStatusEnum = pgEnum("community_post_status", [
  "active",
  "resolved",
  "expired",
]);

export const rsvpStatusEnum = pgEnum("rsvp_status", ["yes", "no", "maybe"]);

// ── Tables ─────────────────────────────────────────────

export const building = pgTable("building", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 500 }).notNull(),
  ico: varchar("ico", { length: 20 }),
  votingMethod: votingMethodEnum("voting_method").notNull().default("per_share"),
  country: countryEnum("country").notNull().default("sk"),
  governanceModel: governanceModelEnum("governance_model").notNull().default("chairman_council"),
  legalNotice: text("legal_notice"),
  communityCrossEntranceVisible: boolean("community_cross_entrance_visible")
    .notNull()
    .default(false),
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
  area: integer("area"),
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
  votingType: votingTypeEnum("voting_type").notNull().default("written"),
  initiatedBy: votingInitiatedByEnum("initiated_by").notNull().default("board"),
  quorumType: quorumTypeEnum("quorum_type").notNull().default("simple_all"),
  voteCounterId: uuid("vote_counter_id").references(() => users.id),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const votes = pgTable(
  "votes",
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
    votingFlatIdx: uniqueIndex("votes_voting_flat_idx").on(
      table.votingId,
      table.flatId
    ),
  })
);

export const mandates = pgTable(
  "mandates",
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
    votingFlatIdx: uniqueIndex("mandates_voting_flat_idx").on(
      table.votingId,
      table.fromFlatId
    ),
  })
);

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

export const userFlats = pgTable(
  "user_flats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    flatId: uuid("flat_id")
      .references(() => flats.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userFlatIdx: uniqueIndex("user_flats_user_flat_idx").on(
      table.userId,
      table.flatId
    ),
  })
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userEndpointIdx: uniqueIndex("push_subscriptions_user_endpoint_idx").on(
      table.userId,
      table.endpoint
    ),
  })
);

export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  newPost: boolean("new_post").notNull().default(true),
  votingStarted: boolean("voting_started").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  role: userRoleEnum("role").notNull().default("owner"),
  flatId: uuid("flat_id").references(() => flats.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedByUserId: uuid("used_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const externalConnections = pgTable("external_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  apiKeyHash: varchar("api_key_hash", { length: 255 }).notNull(),
  apiKeyPrefix: varchar("api_key_prefix", { length: 12 }).notNull(),
  permissions: apiKeyPermissionEnum("permissions").notNull().default("read"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  previousApiKeyHash: varchar("previous_api_key_hash", { length: 255 }),
  previousKeyExpiresAt: timestamp("previous_key_expires_at"),
  pairedAt: timestamp("paired_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pairingRequests = pgTable("pairing_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  partAHash: varchar("part_a_hash", { length: 255 }).notNull(),
  partAPrefix: varchar("part_a_prefix", { length: 12 }).notNull(),
  connectionType: varchar("connection_type", { length: 50 }).notNull(),
  permissions: apiKeyPermissionEnum("permissions").notNull().default("read"),
  status: pairingStatusEnum("status").notNull().default("pending"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: timestamp("locked_at"),
  expiresAt: timestamp("expires_at").notNull(),
  completedAt: timestamp("completed_at"),
  connectionId: uuid("connection_id").references(() => externalConnections.id),
  rotationForConnectionId: uuid("rotation_for_connection_id").references(
    () => externalConnections.id
  ),
  createdById: uuid("created_by_id")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  consentType: consentTypeEnum("consent_type").notNull(),
  action: consentActionEnum("action").notNull(),
  policyVersion: varchar("policy_version", { length: 20 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const externalApiLogs = pgTable("external_api_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").references(() => externalConnections.id),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  statusCode: integer("status_code").notNull(),
  authResult: authResultEnum("auth_result").notNull(),
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communityPosts = pgTable("community_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: communityPostTypeEnum("type").notNull(),
  status: communityPostStatusEnum("status").notNull().default("active"),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  photoUrl: varchar("photo_url", { length: 1000 }),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  eventDate: timestamp("event_date"),
  eventLocation: varchar("event_location", { length: 255 }),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const communityResponses = pgTable("community_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .references(() => communityPosts.id, { onDelete: "cascade" })
    .notNull(),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const directoryEntries = pgTable("directory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  sharePhone: boolean("share_phone").notNull().default(false),
  shareEmail: boolean("share_email").notNull().default(false),
  note: varchar("note", { length: 255 }),
  skills: varchar("skills", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .references(() => communityPosts.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    status: rsvpStatusEnum("status").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    postUserUnique: unique("event_rsvps_post_user_idx").on(
      table.postId,
      table.userId
    ),
  })
);

export const boardMembers = pgTable("board_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id")
    .references(() => building.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  role: boardMemberRoleEnum("role").notNull(),
  electedAt: timestamp("elected_at").notNull(),
  termEndsAt: timestamp("term_ends_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Relations ──────────────────────────────────────────

export const buildingRelations = relations(building, ({ many }) => ({
  entrances: many(entrances),
  boardMembers: many(boardMembers),
}));

export const entrancesRelations = relations(entrances, ({ one, many }) => ({
  building: one(building, {
    fields: [entrances.buildingId],
    references: [building.id],
  }),
  flats: many(flats),
  posts: many(posts),
  votings: many(votings),
  documents: many(documents),
}));

export const flatsRelations = relations(flats, ({ one, many }) => ({
  entrance: one(entrances, {
    fields: [flats.entranceId],
    references: [entrances.id],
  }),
  users: many(users),
  userFlats: many(userFlats),
  votes: many(votes),
  mandates: many(mandates),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  flat: one(flats, {
    fields: [users.flatId],
    references: [flats.id],
  }),
  userFlats: many(userFlats),
  votes: many(votes),
  createdVotings: many(votings, { relationName: "createdBy" }),
  posts: many(posts),
  documents: many(documents),
  pushSubscriptions: many(pushSubscriptions),
  consentRecords: many(consentRecords),
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

export const invitationsRelations = relations(invitations, ({ one }) => ({
  flat: one(flats, {
    fields: [invitations.flatId],
    references: [flats.id],
  }),
  usedBy: one(users, {
    fields: [invitations.usedByUserId],
    references: [users.id],
    relationName: "usedInvitation",
  }),
  createdBy: one(users, {
    fields: [invitations.createdById],
    references: [users.id],
    relationName: "createdInvitations",
  }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

export const userFlatsRelations = relations(userFlats, ({ one }) => ({
  user: one(users, {
    fields: [userFlats.userId],
    references: [users.id],
  }),
  flat: one(flats, {
    fields: [userFlats.flatId],
    references: [flats.id],
  }),
}));

export const externalConnectionsRelations = relations(externalConnections, ({ many }) => ({
  pairingRequests: many(pairingRequests),
  apiLogs: many(externalApiLogs),
}));

export const pairingRequestsRelations = relations(pairingRequests, ({ one }) => ({
  connection: one(externalConnections, {
    fields: [pairingRequests.connectionId],
    references: [externalConnections.id],
  }),
  createdBy: one(users, {
    fields: [pairingRequests.createdById],
    references: [users.id],
  }),
}));

export const externalApiLogsRelations = relations(externalApiLogs, ({ one }) => ({
  connection: one(externalConnections, {
    fields: [externalApiLogs.connectionId],
    references: [externalConnections.id],
  }),
}));

export const consentRecordsRelations = relations(consentRecords, ({ one }) => ({
  user: one(users, {
    fields: [consentRecords.userId],
    references: [users.id],
  }),
}));

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  building: one(building, {
    fields: [boardMembers.buildingId],
    references: [building.id],
  }),
  user: one(users, {
    fields: [boardMembers.userId],
    references: [users.id],
  }),
}));

export const communityPostsRelations = relations(communityPosts, ({ one, many }) => ({
  author: one(users, {
    fields: [communityPosts.authorId],
    references: [users.id],
  }),
  entrance: one(entrances, {
    fields: [communityPosts.entranceId],
    references: [entrances.id],
  }),
  responses: many(communityResponses),
}));

export const communityResponsesRelations = relations(communityResponses, ({ one }) => ({
  post: one(communityPosts, {
    fields: [communityResponses.postId],
    references: [communityPosts.id],
  }),
  author: one(users, {
    fields: [communityResponses.authorId],
    references: [users.id],
  }),
}));

export const eventRsvpsRelations = relations(eventRsvps, ({ one }) => ({
  post: one(communityPosts, {
    fields: [eventRsvps.postId],
    references: [communityPosts.id],
  }),
  user: one(users, {
    fields: [eventRsvps.userId],
    references: [users.id],
  }),
}));

export const directoryEntriesRelations = relations(directoryEntries, ({ one }) => ({
  user: one(users, {
    fields: [directoryEntries.userId],
    references: [users.id],
  }),
}));

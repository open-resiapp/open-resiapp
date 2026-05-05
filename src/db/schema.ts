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
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
  "caretaker",
]);

export const userStatusEnum = pgEnum("user_status", [
  "pending",
  "active",
  "rejected",
]);

// voteChoiceEnum, voteTypeEnum, votingStatusEnum moved to
// modules/voting/src/db/schema.ts under RES-20260505-001.

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

// votingTypeEnum, votingInitiatedByEnum, quorumTypeEnum moved to
// modules/voting/src/db/schema.ts under RES-20260505-001.

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

export const communityNotificationKindEnum = pgEnum(
  "community_notification_kind",
  [
    "response",
    "expiry_reminder",
    "event_reminder",
    "pending_registration_admin",
  ]
);

export const moduleStatusEnum = pgEnum("module_status", [
  "enabled",
  "disabled",
  "failed",
]);

export const entityKindEnum = pgEnum("entity_kind", [
  "housing_community",
  "housing_block",
  "housing_entrance",
  "housing_unit",
  "generic_group",
]);

export const platformRoleEnum = pgEnum("platform_role", [
  "member",
  "superadmin",
]);

export const membershipRoleEnum = pgEnum("membership_role", [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
  "caretaker",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "pending",
  "active",
  "archived",
]);

export const entityAuditActionEnum = pgEnum("entity_audit_action", [
  "entity.create",
  "entity.set_parent",
  "entity.set_kind",
  "entity.archive",
  "entity.hard_delete",
  "membership.create",
  "membership.update_role",
  "membership.remove",
]);

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

// ── Entity model (RES-20260501-002) ──────────────────────
// Self-referencing tree of typed containers. Replaces the rigid
// building → entrance → flat hierarchy with an n-ary tree of
// entities discriminated by `kind`. Path traversal logic lives
// in src/lib/entity-tree.ts; nothing else parses `path`.

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => entities.id,
      { onDelete: "restrict" }
    ),
    kind: entityKindEnum("kind").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(0),
    rootId: uuid("root_id").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    parentIdx: index("entities_parent_idx").on(table.parentId),
    rootIdx: index("entities_root_idx").on(table.rootId),
    kindIdx: index("entities_kind_idx").on(table.kind),
    archivedIdx: index("entities_archived_idx").on(table.archivedAt),
    pathIdx: index("entities_path_idx").using(
      "btree",
      sql`${table.path} text_pattern_ops`
    ),
  })
);

// 1:1 extension data for housing roots (community / block).
// Required when entities.kind in ('housing_community', 'housing_block').
export const housingRootData = pgTable("housing_root_data", {
  entityId: uuid("entity_id")
    .primaryKey()
    .references(() => entities.id, { onDelete: "cascade" }),
  address: varchar("address", { length: 500 }).notNull(),
  ico: varchar("ico", { length: 20 }),
  votingMethod: votingMethodEnum("voting_method")
    .notNull()
    .default("per_share"),
  country: countryEnum("country").notNull().default("sk"),
  governanceModel: governanceModelEnum("governance_model")
    .notNull()
    .default("chairman_council"),
  legalNotice: text("legal_notice"),
  communityCrossEntranceVisible: boolean("community_cross_entrance_visible")
    .notNull()
    .default(false),
});

// 1:1 extension data for housing units (flats).
// Required when entities.kind = 'housing_unit'.
export const housingUnitData = pgTable("housing_unit_data", {
  entityId: uuid("entity_id")
    .primaryKey()
    .references(() => entities.id, { onDelete: "cascade" }),
  flatNumber: varchar("flat_number", { length: 20 }).notNull(),
  floor: integer("floor").notNull().default(0),
  shareNumerator: integer("share_numerator").notNull(),
  shareDenominator: integer("share_denominator").notNull(),
  area: integer("area"),
});

// User ↔ entity link with per-membership role and voting weight.
// Replaces users.flatId + userFlats once the migration ships.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    role: membershipRoleEnum("role").notNull().default("owner"),
    weight: integer("weight").notNull().default(1),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userEntityIdx: uniqueIndex("memberships_user_entity_idx").on(
      table.userId,
      table.entityId
    ),
    entityIdx: index("memberships_entity_idx").on(table.entityId),
    userIdx: index("memberships_user_idx").on(table.userId),
  })
);

// Audit trail for every operator-side mutation of the entity tree
// or memberships. Survives entity / actor deletion via set null FKs.
export const entityAuditLog = pgTable(
  "entity_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: entityAuditActionEnum("action").notNull(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityIdx: index("entity_audit_entity_idx").on(table.entityId),
    actionIdx: index("entity_audit_action_idx").on(table.action),
    actorIdx: index("entity_audit_actor_idx").on(table.actorUserId),
  })
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    role: userRoleEnum("role").notNull().default("owner"),
    platformRole: platformRoleEnum("platform_role").notNull().default("member"),
    flatId: uuid("flat_id").references(() => flats.id),
    isActive: boolean("is_active").notNull().default(true),
    status: userStatusEnum("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    statusIdx: index("users_status_idx").on(table.status),
  })
);

// votings, votes, mandates moved to modules/voting/src/db/schema.ts
// under RES-20260505-001.

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  category: postCategoryEnum("category").notNull().default("info"),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  entranceId: uuid("entrance_id").references(() => entrances.id),
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "restrict",
  }),
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
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "restrict",
  }),
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
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
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

export const registrationTokens = pgTable(
  "registration_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => ({
    activeIdx: index("registration_tokens_active_idx").on(table.isActive),
  })
);

export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("email_verifications_user_idx").on(table.userId),
  })
);

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
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "restrict",
  }),
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

export const communityNotificationsSent = pgTable(
  "community_notifications_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").references(() => communityPosts.id, {
      onDelete: "cascade",
    }),
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    recipientId: uuid("recipient_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: communityNotificationKindEnum("kind").notNull(),
    responderId: uuid("responder_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => ({
    lookupIdx: index("community_notifications_sent_lookup_idx").on(
      table.postId,
      table.recipientId,
      table.kind
    ),
    responderIdx: index("community_notifications_sent_responder_idx").on(
      table.postId,
      table.responderId,
      table.kind
    ),
    subjectIdx: index("community_notifications_sent_subject_idx").on(
      table.subjectUserId,
      table.recipientId,
      table.kind
    ),
  })
);

export const coreModules = pgTable("core_modules", {
  name: varchar("name", { length: 100 }).primaryKey(),
  version: varchar("version", { length: 50 }).notNull(),
  status: moduleStatusEnum("status").notNull().default("enabled"),
  failureCount: integer("failure_count").notNull().default(0),
  lastFailureAt: timestamp("last_failure_at"),
  lastFailureMessage: text("last_failure_message"),
  installPath: text("install_path").notNull(),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const coreModuleGrants = pgTable(
  "core_module_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildingId: uuid("building_id")
      .references(() => building.id, { onDelete: "cascade" })
      .notNull(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    moduleName: varchar("module_name", { length: 100 })
      .references(() => coreModules.name, { onDelete: "cascade" })
      .notNull(),
    permissions: text("permissions").array().notNull(),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
    grantedById: uuid("granted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    buildingModuleIdx: uniqueIndex("core_module_grants_building_module_idx").on(
      table.buildingId,
      table.moduleName
    ),
  })
);

export const boardMembers = pgTable("board_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id")
    .references(() => building.id)
    .notNull(),
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "cascade",
  }),
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
  // Voting back-references moved with the voting module schema.
  documents: many(documents),
}));

export const flatsRelations = relations(flats, ({ one, many }) => ({
  entrance: one(entrances, {
    fields: [flats.entranceId],
    references: [entrances.id],
  }),
  users: many(users),
  userFlats: many(userFlats),
  // Voting back-references moved with the voting module schema.
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  flat: one(flats, {
    fields: [users.flatId],
    references: [flats.id],
  }),
  userFlats: many(userFlats),
  // Voting back-references moved with the voting module schema.
  posts: many(posts),
  documents: many(documents),
  pushSubscriptions: many(pushSubscriptions),
  consentRecords: many(consentRecords),
}));

// votingsRelations, votesRelations, mandatesRelations moved to
// modules/voting/src/db/schema.ts under RES-20260505-001.

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

export const registrationTokensRelations = relations(
  registrationTokens,
  ({ one }) => ({
    createdBy: one(users, {
      fields: [registrationTokens.createdById],
      references: [users.id],
    }),
  })
);

export const emailVerificationsRelations = relations(
  emailVerifications,
  ({ one }) => ({
    user: one(users, {
      fields: [emailVerifications.userId],
      references: [users.id],
    }),
  })
);

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

// ── Entity model relations (RES-20260501-002) ────────────

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  parent: one(entities, {
    fields: [entities.parentId],
    references: [entities.id],
    relationName: "entityParent",
  }),
  children: many(entities, { relationName: "entityParent" }),
  memberships: many(memberships),
  housingRoot: one(housingRootData, {
    fields: [entities.id],
    references: [housingRootData.entityId],
  }),
  housingUnit: one(housingUnitData, {
    fields: [entities.id],
    references: [housingUnitData.entityId],
  }),
}));

export const housingRootDataRelations = relations(housingRootData, ({ one }) => ({
  entity: one(entities, {
    fields: [housingRootData.entityId],
    references: [entities.id],
  }),
}));

export const housingUnitDataRelations = relations(housingUnitData, ({ one }) => ({
  entity: one(entities, {
    fields: [housingUnitData.entityId],
    references: [entities.id],
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [memberships.entityId],
    references: [entities.id],
  }),
}));

export const entityAuditLogRelations = relations(entityAuditLog, ({ one }) => ({
  actor: one(users, {
    fields: [entityAuditLog.actorUserId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [entityAuditLog.entityId],
    references: [entities.id],
  }),
}));

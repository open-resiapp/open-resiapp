import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────

// userRoleEnum + users.role kept as denormalized cache (Phase 9.2
// dropped its FK to legacy `flats` but the column itself stays for
// fast hasPermission() checks at the route layer).
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

// BYT-20260515-001 Phase 1c: entityKindEnum removed. Kinds now live
// in the entity_kinds catalog (per-instance, data-driven). The legacy
// 5-value enum is preserved only in migration 0034's CASE expression
// that converts the column from enum to text FK.

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
  "user.claim_shell",
  "user.merge_shell",
]);

// ── Document library (BYT-20260512-006) ────────────────
// Type taxonomy grounded in §8b/§9/§11 zák. 182/1993 Z.z. Audience is a
// dedicated tier (admin/owner/resident), NOT the operational membership_role
// rank — caretaker/vote_counter don't sit on a single visibility axis. The
// owner tier encodes the §11 owner-inspection categories.
export const documentTypeEnum = pgEnum("document_type", [
  "statutes",
  "house_rules",
  "minutes",
  "vote_result",
  "vendor_contract",
  "works_contract",
  "insurance",
  "revision",
  "budget",
  "settlement",
  "fund_statement",
  "accounting",
  "employment",
  "technical",
  "maintenance",
  "notice",
  "other",
]);

export const documentAudienceEnum = pgEnum("document_audience", [
  "admin",
  "owner",
  "resident",
]);

// Document Project (dossier) lifecycle. BYT-20260608-001.
export const documentProjectStatusEnum = pgEnum("document_project_status", [
  "planned",
  "active",
  "done",
]);

// ── Tables ─────────────────────────────────────────────

// Phase 9.2: legacy `building`, `entrances`, `flats` tables dropped.
// All shape lives in entities + housing_root_data + housing_unit_data.

// ── Entity model (RES-20260501-002) ──────────────────────
// Self-referencing tree of typed containers. Replaces the rigid
// building → entrance → flat hierarchy with an n-ary tree of
// entities discriminated by `kind`. Path traversal logic lives
// in src/lib/entity-tree.ts; nothing else parses `path`.
//
// BYT-20260515-001 Phase 1a: per-instance kind catalog (entity_kinds)
// + entities.data jsonb for per-kind extension fields. The legacy enum
// column entities.kind stays in place until Phase 1b backfills the
// catalog and flips the column to a text FK.

// Per-instance kind catalog. Each instance owns its rows — seeded at
// install time from the selected template (hoa, garden, garage, …).
// Instance admins may add custom kinds without code deploy.
export const entityKinds = pgTable("entity_kinds", {
  slug: varchar("slug", { length: 64 }).primaryKey(),
  displayNameKey: varchar("display_name_key", { length: 200 }).notNull(),
  icon: varchar("icon", { length: 64 }),
  allowsMembers: boolean("allows_members").notNull().default(false),
  votable: boolean("votable").notNull().default(false),
  // Soft validation. Empty array = root only. Enforced in app layer,
  // not via DB constraint, to allow per-instance customization.
  allowedParentKinds: text("allowed_parent_kinds").array().notNull().default(sql`'{}'::text[]`),
  // JSON Schema describing entities.data when kind = this slug. Used by
  // the import wizard to generate column-mapping forms and by the UI
  // to render per-kind detail editors.
  dataSchema: jsonb("data_schema").notNull().default(sql`'{}'::jsonb`),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => entities.id,
      { onDelete: "restrict" }
    ),
    kind: varchar("kind", { length: 64 })
      .notNull()
      .references(() => entityKinds.slug, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(0),
    rootId: uuid("root_id").notNull(),
    // Per-kind extension fields. Replaces housing_root_data /
    // housing_unit_data in Phase 2 of BYT-20260515-001. Shape per row
    // is governed by entity_kinds.data_schema for that kind.
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
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

// BYT-20260515-001 Phase 8b: housing_root_data and housing_unit_data
// dropped. Their fields live on entities.data jsonb. Migration
// 0036_drop_legacy_housing_data.sql removes the underlying tables;
// schema definitions removed here.

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
    // Owner's share of the unit (rational). For sole owners = 1/1; for BSM
    // co-owners = 1/2 + 1/2; for heirs of differing shares = e.g. 1/4 + 1/4 + 1/2.
    // Sum across active memberships per unit MUST equal 1/1 (enforced at the
    // application level, not via SQL CHECK).
    // Used by the voting engine refactor (BYT-20260511-001) to resolve
    // multi-owner unit votes per §14 ods. 4 zák. 182/1993 Z.z.
    ownerUnitShareNumerator: integer("owner_unit_share_numerator")
      .notNull()
      .default(1),
    ownerUnitShareDenominator: integer("owner_unit_share_denominator")
      .notNull()
      .default(1),
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
    // Nullable since BYT-20260508-003 (easy-import): shell users seeded
    // from a Kataster LV have no email until pairing fills it in.
    email: varchar("email", { length: 255 }),
    // Nullable for the same reason — shell users have no login until
    // they're paired and set a password.
    passwordHash: varchar("password_hash", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    role: userRoleEnum("role").notNull().default("owner"),
    platformRole: platformRoleEnum("platform_role").notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    status: userStatusEnum("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Partial unique index — multiple shell users with NULL email may coexist.
    emailIdx: uniqueIndex("users_email_idx")
      .on(table.email)
      .where(sql`${table.email} IS NOT NULL`),
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
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "restrict" })
    .notNull(),
  isPinned: boolean("is_pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    // Storage key resolved via src/lib/storage.ts (local disk or S3/Hetzner).
    // Replaces the legacy file_url column.
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    originalName: varchar("original_name", { length: 255 }),
    mimeType: varchar("mime_type", { length: 127 }),
    sizeBytes: integer("size_bytes"),
    type: documentTypeEnum("type").notNull().default("other"),
    // Visibility tier. Resolution (authority-from-above ∪ subtree-broadcast)
    // lives in src/lib/documents.ts, not here.
    audience: documentAudienceEnum("audience").notNull().default("admin"),
    // Legal retention horizon (§431/2002, §9 ods. 5). Informational in v1 —
    // no auto-purge; deletion is soft (deletedAt).
    retainUntil: date("retain_until"),
    // Optional grouping into a named dossier (BYT-20260608-001). Set null on
    // project delete — the document reverts to standalone.
    projectId: uuid("project_id").references(() => documentProjects.id, {
      onDelete: "set null",
    }),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityIdx: index("documents_entity_idx").on(table.entityId),
    typeIdx: index("documents_type_idx").on(table.type),
    deletedIdx: index("documents_deleted_idx").on(table.deletedAt),
    projectIdx: index("documents_project_idx").on(table.projectId),
  })
);

// Per-(document, viewer) access trail — evidences §11 fulfilment + GDPR
// accountability. Dedicated table (not entity_audit_log): read events are
// high-volume with a different lifecycle than entity mutations.
export const documentAccessLog = pgTable(
  "document_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    accessedAt: timestamp("accessed_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("document_access_document_idx").on(table.documentId),
    userIdx: index("document_access_user_idx").on(table.userId),
  })
);

// Named dossier grouping a set of documents (e.g. "Rekonštrukcia balkónov").
// BYT-20260608-001. A voting links one project; the library lists its docs.
// Documents reference this via documents.project_id (set null on delete).
export const documentProjects = pgTable(
  "document_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    audience: documentAudienceEnum("audience").notNull().default("owner"),
    status: documentProjectStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityIdx: index("document_projects_entity_idx").on(table.entityId),
  })
);

// Phase 9.2: legacy `user_flats` table dropped — replaced by memberships.

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

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    role: userRoleEnum("role").notNull().default("owner"),
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
    // BYT-20260512-001: when set, claiming the token promotes this shell
    // user in place (preserving its memberships) instead of creating a new
    // user row.
    targetShellUserId: uuid("target_shell_user_id").references(
      () => users.id,
      { onDelete: "cascade" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    targetShellIdx: index("invitations_target_shell_idx")
      .on(table.targetShellUserId)
      .where(sql`${table.targetShellUserId} IS NOT NULL`),
  })
);

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

// BYT-20260513-006: replay protection for cloud SSO JWTs.
// Each successfully consumed token's jti lands here; the unique PK
// makes a second insert fail, which the SSO endpoint surfaces as
// sso_replay. expires_at is the JWT's exp claim so a daily cleanup
// cron can prune the table.
export const ssoConsumedTokens = pgTable(
  "sso_consumed_tokens",
  {
    jti: varchar("jti", { length: 64 }).primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    expiresIdx: index("sso_consumed_tokens_expires_idx").on(table.expiresAt),
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
  // Per-post switch: when false the respond endpoint rejects new responses
  // and the UI hides the response form. Existing responses stay visible.
  responsesAllowed: boolean("responses_allowed").notNull().default(true),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  photoUrl: varchar("photo_url", { length: 1000 }),
  authorId: uuid("author_id")
    .references(() => users.id)
    .notNull(),
  eventDate: timestamp("event_date"),
  eventLocation: varchar("event_location", { length: 255 }),
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "restrict" })
    .notNull(),
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
    entityId: uuid("entity_id")
      .references(() => entities.id, { onDelete: "cascade" })
      .notNull(),
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
    entityModuleIdx: uniqueIndex("core_module_grants_entity_module_idx").on(
      table.entityId,
      table.moduleName
    ),
  })
);

export const boardMembers = pgTable("board_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "cascade" })
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
// Phase 9.2: dropped buildingRelations, entrancesRelations,
// flatsRelations, userFlatsRelations. Entity tree (entities +
// housing_*_data + memberships) is canonical.

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  documents: many(documents),
  pushSubscriptions: many(pushSubscriptions),
  consentRecords: many(consentRecords),
  memberships: many(memberships),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [posts.entityId],
    references: [entities.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  uploadedBy: one(users, {
    fields: [documents.uploadedById],
    references: [users.id],
  }),
  entity: one(entities, {
    fields: [documents.entityId],
    references: [entities.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  entity: one(entities, {
    fields: [invitations.entityId],
    references: [entities.id],
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
  entity: one(entities, {
    fields: [boardMembers.entityId],
    references: [entities.id],
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
  entity: one(entities, {
    fields: [communityPosts.entityId],
    references: [entities.id],
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
  // Phase 8b: housingRoot / housingUnit relations dropped along with
  // their tables. Per-kind fields live on entities.data jsonb.
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

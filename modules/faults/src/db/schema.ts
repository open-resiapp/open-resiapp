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
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { entities, users } from "@/db/schema";

// Fault reports module (BYT-20261118-004). Resident-authored fault +
// board-owned task fields + append-only history. All tables are prefixed
// `mod_faults_`. Reads go through src/lib/queries.server.ts only.

// ── Enums ──────────────────────────────────────────────

// `withdrawn` = reporter withdrew while still `new` (decided 2026-11-18:
// keeps the record + history for the board instead of a hard delete).
export const faultStatusEnum = pgEnum("mod_faults_status", [
  "new",
  "in_progress",
  "resolved",
  "rejected",
  "withdrawn",
]);

export const faultPriorityEnum = pgEnum("mod_faults_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const faultVisibilityEnum = pgEnum("mod_faults_visibility", [
  "community",
  "entrance",
  "private",
]);

export const faultEventTypeEnum = pgEnum("mod_faults_event_type", [
  "created",
  "edited",
  "status_changed",
  "field_changed",
  "photo_added",
  "photo_removed",
]);

export const faultNotificationKindEnum = pgEnum("mod_faults_notification_kind", [
  "status_changed",
  "stale_digest",
]);

// ── Categories (per-community catalog) ─────────────────
// Seeded rows carry `slug` + `name_key` (Faults.category.<slug>); rows the
// board adds carry `custom_name` (user data, not translated). The seed
// catalog is FAULT_CATEGORY_SLUGS in src/engine/catalog.ts.
export const faultCategories = pgTable(
  "mod_faults_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootEntityId: uuid("root_entity_id")
      .references(() => entities.id, { onDelete: "cascade" })
      .notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    nameKey: varchar("name_key", { length: 200 }),
    customName: varchar("custom_name", { length: 120 }),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    rootSlugIdx: uniqueIndex("mod_faults_categories_root_slug_idx").on(
      table.rootEntityId,
      table.slug
    ),
  })
);

// ── Contractors (external assignees; never e-mailed in MVP) ──
export const faultContractors = pgTable(
  "mod_faults_contractors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootEntityId: uuid("root_entity_id")
      .references(() => entities.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 255 }),
    ico: varchar("ico", { length: 20 }),
    note: text("note"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    rootIdx: index("mod_faults_contractors_root_idx").on(table.rootEntityId),
  })
);

// ── Faults ─────────────────────────────────────────────
export const faults = pgTable(
  "mod_faults_faults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootEntityId: uuid("root_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    /** unit / entrance / building / root the fault is at. */
    locationEntityId: uuid("location_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    /** Subtree whose members see an `entrance` fault (downward only). */
    scopeEntityId: uuid("scope_entity_id")
      .references(() => entities.id, { onDelete: "restrict" })
      .notNull(),
    locationNote: varchar("location_note", { length: 255 }),
    /** Nullable: deleting the user keeps the task. */
    reporterId: uuid("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    status: faultStatusEnum("status").notNull().default("new"),
    visibility: faultVisibilityEnum("visibility").notNull(),
    priority: faultPriorityEnum("priority").notNull().default("normal"),
    categoryId: uuid("category_id").references(() => faultCategories.id, {
      onDelete: "set null",
    }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contractorId: uuid("contractor_id").references(() => faultContractors.id, {
      onDelete: "set null",
    }),
    invoiced: boolean("invoiced").notNull().default(false),
    // Optional link to mod_accounting_expenses.id. Deliberately NO FK
    // (decided 2026-11-18): the two modules stay decoupled; the id is
    // validated in app code (FAULT_EXPENSE_NOT_FOUND) when it is set.
    expenseId: uuid("expense_id"),
    internalNote: text("internal_note"),
    /** First board-side change; once set the reporter can no longer withdraw/edit. */
    boardTouchedAt: timestamp("board_touched_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    rootStatusIdx: index("mod_faults_faults_root_status_created_idx").on(
      table.rootEntityId,
      table.status,
      table.createdAt
    ),
    reporterIdx: index("mod_faults_faults_reporter_idx").on(table.reporterId),
    assigneeIdx: index("mod_faults_faults_assignee_idx").on(table.assigneeUserId),
    assigneeCheck: check(
      "mod_faults_faults_assignee_check",
      sql`NOT (${table.assigneeUserId} IS NOT NULL AND ${table.contractorId} IS NOT NULL)`
    ),
  })
);

// ── Photos ─────────────────────────────────────────────
// Stored under the `faults/` key prefix with a random UUID name; served
// ONLY by GET /api/modules/faults/photos/[photoId] (visibility-checked).
export const faultPhotos = pgTable(
  "mod_faults_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    faultId: uuid("fault_id")
      .references(() => faults.id, { onDelete: "cascade" })
      .notNull(),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    faultIdx: index("mod_faults_photos_fault_idx").on(table.faultId),
  })
);

// ── Events (append-only history) ───────────────────────
export const faultEvents = pgTable(
  "mod_faults_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    faultId: uuid("fault_id")
      .references(() => faults.id, { onDelete: "cascade" })
      .notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: faultEventTypeEnum("type").notNull(),
    field: varchar("field", { length: 64 }),
    /** Snapshots (names of assignee / contractor / category), not live refs. */
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    publicMessage: text("public_message"),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    faultCreatedIdx: index("mod_faults_events_fault_created_idx").on(
      table.faultId,
      table.createdAt
    ),
  })
);

// ── Notifications sent (ONE table, kind enum — project rule) ──
export const faultNotificationsSent = pgTable(
  "mod_faults_notifications_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: faultNotificationKindEnum("kind").notNull(),
    faultId: uuid("fault_id")
      .references(() => faults.id, { onDelete: "cascade" })
      .notNull(),
    recipientId: uuid("recipient_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id").references(() => faultEvents.id, {
      onDelete: "cascade",
    }),
    /** status_changed: <eventId>; stale_digest: <faultId>:<ISO week>. */
    dedupeKey: varchar("dedupe_key", { length: 120 }).notNull(),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("mod_faults_notifications_sent_dedupe_idx").on(
      table.kind,
      table.recipientId,
      table.dedupeKey
    ),
    faultKindIdx: index("mod_faults_notifications_sent_fault_kind_idx").on(
      table.faultId,
      table.kind,
      table.sentAt
    ),
  })
);

export type FaultRow = typeof faults.$inferSelect;
export type FaultStatus = (typeof faultStatusEnum.enumValues)[number];
export type FaultPriority = (typeof faultPriorityEnum.enumValues)[number];
export type FaultVisibility = (typeof faultVisibilityEnum.enumValues)[number];

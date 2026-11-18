import "server-only";

import { aliasedTable, and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";

import type { FaultFilters } from "../engine/filters";
import { STALE_DAYS, type FaultPriority, type FaultStatus } from "../engine/transitions";
import {
  isFullOnlyEvent,
  toResidentView,
  type FaultBoardAccess,
  type FaultBoardView,
  type FaultPublicEvent,
  type FaultResidentView,
  type ResidentRow,
} from "../engine/views";
import { faultContractors, faultEvents, faultPhotos, faults } from "../db/schema";

// The ONLY read path for mod_faults_faults (BYT-20261118-004). Resident
// reads select an explicit column list and apply the visibility predicate
// in SQL; board reads require a board access level from authz.server.ts.

const loc = aliasedTable(entities, "fault_loc");
const STALE_INTERVAL = sql.raw(`interval '${STALE_DAYS} days'`);

// ── Resident ───────────────────────────────────────────

/**
 * Visibility predicate (spec): own report, OR community-wide, OR an
 * `entrance` fault whose scope subtree contains one of the viewer's active
 * memberships (downward only). Withdrawn reports stay visible only to
 * their reporter.
 */
function residentVisible(userId: string): SQL {
  return sql`(
    ${faults.reporterId} = ${userId}
    OR (
      ${faults.status} <> 'withdrawn'
      AND (
        ${faults.visibility} = 'community'
        OR (
          ${faults.visibility} = 'entrance'
          AND EXISTS (
            SELECT 1
            FROM ${memberships} m
            JOIN ${entities} me ON me.id = m.entity_id
            JOIN ${entities} se ON se.id = ${faults.scopeEntityId}
            WHERE m.user_id = ${userId}
              AND m.status = 'active'
              AND me.path LIKE se.path || '%'
          )
        )
      )
    )
  )`;
}

function residentColumns(userId: string) {
  return {
    id: faults.id,
    title: faults.title,
    description: faults.description,
    status: faults.status,
    locationLabel: loc.name,
    locationNote: faults.locationNote,
    visibility: faults.visibility,
    createdAt: faults.createdAt,
    updatedAt: faults.updatedAt,
    resolvedAt: faults.resolvedAt,
    isMine: sql<boolean>`(${faults.reporterId} IS NOT NULL AND ${faults.reporterId} = ${userId})`,
  };
}

async function attachResident(rows: ResidentRow[]): Promise<FaultResidentView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [photos, events] = await Promise.all([
    db
      .select({ id: faultPhotos.id, faultId: faultPhotos.faultId })
      .from(faultPhotos)
      .where(inArray(faultPhotos.faultId, ids))
      .orderBy(asc(faultPhotos.createdAt)),
    db
      .select({
        faultId: faultEvents.faultId,
        newValue: faultEvents.newValue,
        type: faultEvents.type,
        message: faultEvents.publicMessage,
        createdAt: faultEvents.createdAt,
      })
      .from(faultEvents)
      // Only public events ever leave the server for residents.
      .where(and(inArray(faultEvents.faultId, ids), eq(faultEvents.isPublic, true)))
      .orderBy(asc(faultEvents.createdAt)),
  ]);
  const photosBy = new Map<string, { id: string }[]>();
  for (const p of photos) {
    const list = photosBy.get(p.faultId) ?? [];
    list.push({ id: p.id });
    photosBy.set(p.faultId, list);
  }
  const eventsBy = new Map<string, FaultPublicEvent[]>();
  for (const e of events) {
    const list = eventsBy.get(e.faultId) ?? [];
    list.push({
      status: e.type === "status_changed" ? (e.newValue as FaultStatus | null) : null,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    });
    eventsBy.set(e.faultId, list);
  }
  return rows.map((r) => toResidentView(r, photosBy.get(r.id) ?? [], eventsBy.get(r.id) ?? []));
}

/** "Moje hlásenia" (mine) or "Hlásenia v dome" (others visible to me). */
export async function listFaultsForResident(
  userId: string,
  rootId: string,
  which: "mine" | "others"
): Promise<FaultResidentView[]> {
  const mineCond =
    which === "mine"
      ? eq(faults.reporterId, userId)
      : sql`(${faults.reporterId} IS NULL OR ${faults.reporterId} <> ${userId})`;
  const rows = await db
    .select(residentColumns(userId))
    .from(faults)
    .innerJoin(loc, eq(loc.id, faults.locationEntityId))
    .where(and(eq(faults.rootEntityId, rootId), residentVisible(userId), mineCond))
    .orderBy(desc(faults.createdAt))
    .limit(200);
  return attachResident(rows as ResidentRow[]);
}

export async function getFaultForResident(
  userId: string,
  rootId: string,
  id: string
): Promise<FaultResidentView | null> {
  const rows = await db
    .select(residentColumns(userId))
    .from(faults)
    .innerJoin(loc, eq(loc.id, faults.locationEntityId))
    .where(and(eq(faults.id, id), eq(faults.rootEntityId, rootId), residentVisible(userId)))
    .limit(1);
  const [view] = await attachResident(rows as ResidentRow[]);
  return view ?? null;
}

/** May `userId` see fault `faultId` as a resident? (photo route) */
export async function residentCanSeeFault(
  userId: string,
  rootId: string,
  faultId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: faults.id })
    .from(faults)
    .where(and(eq(faults.id, faultId), eq(faults.rootEntityId, rootId), residentVisible(userId)))
    .limit(1);
  return !!row;
}

/** Owner Domov card: the viewer's open reports by status. */
export async function countMyOpenFaults(
  userId: string,
  rootId: string
): Promise<{ new: number; inProgress: number }> {
  const rows = await db
    .select({ status: faults.status, n: sql<number>`count(*)::int` })
    .from(faults)
    .where(
      and(
        eq(faults.rootEntityId, rootId),
        eq(faults.reporterId, userId),
        inArray(faults.status, ["new", "in_progress"])
      )
    )
    .groupBy(faults.status);
  return {
    new: rows.find((r) => r.status === "new")?.n ?? 0,
    inProgress: rows.find((r) => r.status === "in_progress")?.n ?? 0,
  };
}

// ── Board ──────────────────────────────────────────────

export interface FaultBoardListItem {
  id: string;
  title: string;
  status: FaultStatus;
  priority: FaultPriority;
  locationLabel: string;
  categoryId: string | null;
  assigneeName: string | null;
  contractorName: string | null;
  createdAt: string;
}

const PRIORITY_ORDER = sql`CASE ${faults.priority}
  WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

const staleCond = () =>
  and(
    inArray(faults.status, ["new", "in_progress"]),
    sql`${faults.createdAt} < now() - ${STALE_INTERVAL}`
  );

export async function listFaultsForBoard(
  rootId: string,
  filters: FaultFilters
): Promise<FaultBoardListItem[]> {
  const assignee = aliasedTable(users, "fault_assignee");
  const conds: (SQL | undefined)[] = [eq(faults.rootEntityId, rootId)];
  if (filters.status.length) conds.push(inArray(faults.status, filters.status));
  else conds.push(notInArray(faults.status, ["withdrawn"]));
  if (filters.priority) conds.push(eq(faults.priority, filters.priority));
  if (filters.categoryId) conds.push(eq(faults.categoryId, filters.categoryId));
  if (filters.assignee === "none") {
    conds.push(isNull(faults.assigneeUserId), isNull(faults.contractorId));
  } else if (filters.assignee?.startsWith("c:")) {
    conds.push(eq(faults.contractorId, filters.assignee.slice(2)));
  } else if (filters.assignee) {
    conds.push(eq(faults.assigneeUserId, filters.assignee));
  }
  if (filters.stale) conds.push(staleCond());

  const rows = await db
    .select({
      id: faults.id,
      title: faults.title,
      status: faults.status,
      priority: faults.priority,
      locationLabel: loc.name,
      categoryId: faults.categoryId,
      assigneeName: assignee.name,
      contractorName: faultContractors.name,
      createdAt: faults.createdAt,
    })
    .from(faults)
    .innerJoin(loc, eq(loc.id, faults.locationEntityId))
    .leftJoin(assignee, eq(assignee.id, faults.assigneeUserId))
    .leftJoin(faultContractors, eq(faultContractors.id, faults.contractorId))
    .where(and(...conds))
    .orderBy(PRIORITY_ORDER, asc(faults.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getFaultForBoard(
  rootId: string,
  id: string,
  access: FaultBoardAccess
): Promise<FaultBoardView | null> {
  const assignee = aliasedTable(users, "fault_assignee");
  const reporter = aliasedTable(users, "fault_reporter");
  const [row] = await db
    .select({
      id: faults.id,
      title: faults.title,
      description: faults.description,
      status: faults.status,
      priority: faults.priority,
      visibility: faults.visibility,
      locationEntityId: faults.locationEntityId,
      locationLabel: loc.name,
      locationNote: faults.locationNote,
      reporterId: faults.reporterId,
      reporterName: reporter.name,
      categoryId: faults.categoryId,
      assigneeUserId: faults.assigneeUserId,
      assigneeName: assignee.name,
      contractorId: faults.contractorId,
      contractorName: faultContractors.name,
      invoiced: faults.invoiced,
      expenseId: faults.expenseId,
      internalNote: faults.internalNote,
      createdAt: faults.createdAt,
      updatedAt: faults.updatedAt,
      resolvedAt: faults.resolvedAt,
      boardTouchedAt: faults.boardTouchedAt,
    })
    .from(faults)
    .innerJoin(loc, eq(loc.id, faults.locationEntityId))
    .leftJoin(reporter, eq(reporter.id, faults.reporterId))
    .leftJoin(assignee, eq(assignee.id, faults.assigneeUserId))
    .leftJoin(faultContractors, eq(faultContractors.id, faults.contractorId))
    .where(and(eq(faults.id, id), eq(faults.rootEntityId, rootId)))
    .limit(1);
  if (!row) return null;

  const actor = aliasedTable(users, "fault_actor");
  const [photos, events] = await Promise.all([
    db
      .select({ id: faultPhotos.id })
      .from(faultPhotos)
      .where(eq(faultPhotos.faultId, id))
      .orderBy(asc(faultPhotos.createdAt)),
    db
      .select({
        id: faultEvents.id,
        type: faultEvents.type,
        field: faultEvents.field,
        oldValue: faultEvents.oldValue,
        newValue: faultEvents.newValue,
        publicMessage: faultEvents.publicMessage,
        isPublic: faultEvents.isPublic,
        actorName: actor.name,
        createdAt: faultEvents.createdAt,
      })
      .from(faultEvents)
      .leftJoin(actor, eq(actor.id, faultEvents.actorId))
      .where(eq(faultEvents.faultId, id))
      .orderBy(desc(faultEvents.createdAt)),
  ]);

  const full = access === "full";
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    visibility: row.visibility,
    locationEntityId: row.locationEntityId,
    locationLabel: row.locationLabel,
    locationNote: row.locationNote,
    reporterId: row.reporterId,
    reporterName: row.reporterName,
    categoryId: row.categoryId,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assigneeName,
    contractorId: row.contractorId,
    contractorName: row.contractorName,
    invoiced: full ? row.invoiced : null,
    expenseId: full ? row.expenseId : null,
    internalNote: full ? row.internalNote : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    boardTouched: row.boardTouchedAt !== null,
    photos,
    events: events
      .filter((e) => full || !isFullOnlyEvent(e.field))
      .map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}

/** Board Domov "Čo treba teraz": new faults + faults open > 30 days. */
export async function countBoardFaults(rootId: string): Promise<{ new: number; stale: number }> {
  const [row] = await db
    .select({
      newCount: sql<number>`count(*) FILTER (WHERE ${faults.status} = 'new')::int`,
      staleCount: sql<number>`count(*) FILTER (WHERE ${faults.status} IN ('new','in_progress') AND ${faults.createdAt} < now() - ${STALE_INTERVAL})::int`,
    })
    .from(faults)
    .where(eq(faults.rootEntityId, rootId));
  return { new: row?.newCount ?? 0, stale: row?.staleCount ?? 0 };
}

/** Raw row for mutations (board + reporter checks). */
export async function loadFaultRow(rootId: string, id: string) {
  const [row] = await db
    .select()
    .from(faults)
    .where(and(eq(faults.id, id), eq(faults.rootEntityId, rootId)))
    .limit(1);
  return row ?? null;
}

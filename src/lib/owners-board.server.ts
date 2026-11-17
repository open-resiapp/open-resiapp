import "server-only";

import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { entities, entityAuditLog, invitations, memberships, users } from "@/db/schema";
import { rankCandidates } from "@/lib/name-match";
import { mul, rational } from "@/lib/rational";
import type { UserRole } from "@/types";
import type {
  CreateOwnerErrorCode,
  InboxItem,
  MergeCandidate,
  MergeShellOption,
  OwnerDetailData,
  OwnerFlat,
  OwnerRow,
  OwnersBoardData,
  OwnerStatus,
  UnitOption,
} from "@/lib/owners-board";

// BYT-20261117-002 Phase 5 — everything the Vlastníci page needs in one pass:
// people with a derived account status, the approval inbox, the unit list for
// the add/approve dialogs and the merge pickers. Read-only, four indexed
// queries run in parallel, no caching across requests (multi-replica safe).
// Replaces the client fetches of /api/users, /api/admin/shell-users,
// /api/admin/pending-registrations and /api/flats on the owners screens.

const ROLES: UserRole[] = ["admin", "owner", "tenant", "vote_counter", "caretaker"];

// Same name-similarity threshold the pending-registrations API uses.
const SUGGESTION_THRESHOLD = 0.5;

function compareFlat(a: string, b: string): number {
  return a.localeCompare(b, "sk", { numeric: true, sensitivity: "base" });
}

// Explicit row types: drizzle's inference collapses to `never` for selects that
// leftJoin an aliasedTable (same workaround as GET /api/users).
interface MembershipRow {
  userId: string;
  unitId: string;
  flatNumber: string | null;
  entranceName: string | null;
  floor: number | null;
  shareNum: number;
  shareDen: number;
}
interface UnitRow {
  id: string;
  flatNumber: string | null;
  entranceName: string | null;
}

/** Users holding any membership (any status) on an entity of `rootId`. */
function usersInRootSubquery(rootId: string) {
  return db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(eq(entities.rootId, rootId));
}

/** True when `userId` holds any membership inside the community `rootId`. */
export async function isUserInRoot(userId: string, rootId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(and(eq(memberships.userId, userId), eq(entities.rootId, rootId)))
    .limit(1);
  return !!row;
}

// Every query is scoped to the current community root (entities.root_id),
// same as /api/admin/shell-users via listPendingShellUsers(rootId). The one
// exception mirrors /api/admin/pending-registrations: bulk-QR self-registrants
// (pending, with a password, no active membership anywhere) have no community
// until an admin merges them, so they are listed for every root.
async function loadRaw(rootId: string) {
  const entrance = aliasedTable(entities, "entrance");
  const flatNumberExpr = sql<string>`${entities.data}->>'flat_number'`;
  const inRoot = usersInRootSubquery(rootId);
  const withActiveMembership = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.status, "active"));

  const usersQ = () =>
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        status: users.status,
        hasPassword: sql<boolean>`${users.passwordHash} is not null`,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        or(
          inArray(users.id, inRoot),
          and(
            eq(users.status, "pending"),
            isNotNull(users.passwordHash),
            notInArray(users.id, withActiveMembership)
          )
        )
      );
  const membershipsQ = async (): Promise<MembershipRow[]> =>
    db
      .select({
        userId: memberships.userId,
        unitId: entities.id,
        flatNumber: sql<string>`${entities.data}->>'flat_number'`,
        entranceName: entrance.name,
        floor: sql<number | null>`(${entities.data}->>'floor')::int`,
        shareNum: memberships.ownerUnitShareNumerator,
        shareDen: memberships.ownerUnitShareDenominator,
      })
      .from(memberships)
      .innerJoin(entities, eq(memberships.entityId, entities.id))
      .leftJoin(entrance, eq(entrance.id, entities.parentId))
      .where(
        and(
          eq(memberships.status, "active"),
          eq(entities.kind, "unit"),
          eq(entities.rootId, rootId),
          isNull(entities.archivedAt)
        )
      );
  const unitsQ = async (): Promise<UnitRow[]> =>
    db
      .select({
        id: entities.id,
        flatNumber: sql<string>`${entities.data}->>'flat_number'`,
        entranceName: entrance.name,
      })
      .from(entities)
      .leftJoin(entrance, eq(entrance.id, entities.parentId))
      .where(
        and(eq(entities.kind, "unit"), eq(entities.rootId, rootId), isNull(entities.archivedAt))
      )
      .orderBy(asc(entrance.name), asc(flatNumberExpr));
  const invitesQ = () =>
    db
      .select({
        shellId: invitations.targetShellUserId,
        createdAt: invitations.createdAt,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.status, "pending"),
          isNotNull(invitations.targetShellUserId),
          inArray(invitations.targetShellUserId, inRoot)
        )
      )
      .orderBy(desc(invitations.createdAt));

  const [userRows, membershipRows, unitRows, inviteRows] = await Promise.all([
    usersQ(),
    membershipsQ(),
    unitsQ(),
    invitesQ(),
  ]);
  return { userRows, membershipRows, unitRows, inviteRows };
}

function buildBoard(
  raw: Awaited<ReturnType<typeof loadRaw>>,
  opts: { includeUserId?: string } = {}
): OwnersBoardData {
  const { userRows: allUserRows, membershipRows, unitRows, inviteRows } = raw;
  // Rejected registrations were dismissed on purpose — not people of the
  // house. The detail page may still open one (it could before).
  const userRows = allUserRows.filter(
    (u) => u.status !== "rejected" || u.id === opts.includeUserId
  );
  const now = Date.now();

  const flatsByUser = new Map<string, OwnerFlat[]>();
  for (const m of membershipRows) {
    const list = flatsByUser.get(m.userId) ?? [];
    list.push({
      unitId: m.unitId,
      flatNumber: m.flatNumber ?? "",
      entranceName: m.entranceName,
      floor: m.floor,
      shareNum: m.shareNum,
      shareDen: m.shareDen,
    });
    flatsByUser.set(m.userId, list);
  }
  for (const list of flatsByUser.values()) list.sort((a, b) => compareFlat(a.flatNumber, b.flatNumber));

  // Latest open invitation per shell (rows are ordered newest first).
  const inviteByShell = new Map<string, { createdAt: Date; expiresAt: Date }>();
  for (const i of inviteRows) {
    if (i.shellId && !inviteByShell.has(i.shellId)) inviteByShell.set(i.shellId, i);
  }

  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  const people: OwnerRow[] = userRows.map((u) => {
    const flats = flatsByUser.get(u.id) ?? [];
    const invite = !u.hasPassword ? inviteByShell.get(u.id) : undefined;
    let status: OwnerStatus;
    if (!u.hasPassword) status = invite ? "invited" : "no_account";
    else if (u.status === "pending") status = "pending";
    else status = "active";
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status,
      deactivated: !u.isActive,
      emailVerified: u.emailVerifiedAt !== null,
      flats,
      invite: invite
        ? {
            sentAt: invite.createdAt.toISOString(),
            expiresAt: invite.expiresAt.toISOString(),
            expired: invite.expiresAt.getTime() < now,
          }
        : null,
      createdAt: u.createdAt.toISOString(),
      // mergeShellIntoUser only accepts a pending shell without an e-mail.
      mergeable: !u.hasPassword && u.email === null && u.status === "pending",
    };
  });

  people.sort((a, b) => {
    const fa = a.flats[0]?.flatNumber;
    const fb = b.flats[0]?.flatNumber;
    if (fa && fb) {
      const c = compareFlat(fa, fb);
      if (c !== 0) return c;
    } else if (fa) return -1;
    else if (fb) return 1;
    return a.name.localeCompare(b.name, "sk");
  });

  const mergeShells: MergeShellOption[] = people
    .filter((p) => p.mergeable)
    .map((p) => ({ id: p.id, name: p.name, flatNumber: p.flats[0]?.flatNumber ?? null }));

  // Same population as the nav badge (countPendingRegistrations in
  // shell.server.ts): self-registrants with a password, status pending.
  const pendingPeople = people
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const inbox: InboxItem[] = pendingPeople.map((p) => {
    // Suggest only for registrants that are not linked to a flat yet —
    // exactly the population the old approval page matched.
    const top =
      p.flats.length === 0
        ? rankCandidates(p.name, mergeShells, SUGGESTION_THRESHOLD)[0] ?? null
        : null;
    return {
      id: p.id,
      name: p.name,
      email: p.email ?? "",
      phone: p.phone,
      createdAt: p.createdAt,
      emailVerified: p.emailVerified,
      flats: p.flats,
      suggestion: top
        ? {
            shellId: top.candidate.id,
            shellName: top.candidate.name,
            flatNumber: top.candidate.flatNumber,
            score: top.score,
          }
        : null,
    };
  });

  const mergeCandidates: MergeCandidate[] = pendingPeople
    .filter((p) => p.flats.length === 0 && p.email)
    .map((p) => ({ id: p.id, name: p.name, email: p.email ?? "" }));

  const ownersByUnit = new Map<string, UnitOption["owners"]>();
  for (const m of membershipRows) {
    const list = ownersByUnit.get(m.unitId) ?? [];
    list.push({
      userId: m.userId,
      name: nameById.get(m.userId) ?? "",
      shareNum: m.shareNum,
      shareDen: m.shareDen,
    });
    ownersByUnit.set(m.unitId, list);
  }
  const units: UnitOption[] = unitRows.map((u) => ({
    id: u.id,
    flatNumber: u.flatNumber ?? "",
    entranceName: u.entranceName,
    owners: ownersByUnit.get(u.id) ?? [],
  }));

  return { people, inbox, units, mergeShells, mergeCandidates };
}

const EMPTY_BOARD: OwnersBoardData = {
  people: [],
  inbox: [],
  units: [],
  mergeShells: [],
  mergeCandidates: [],
};

/** `rootId` = the viewer's current community (resolveCurrentEntityId). */
export async function loadOwnersBoard(rootId: string | null): Promise<OwnersBoardData> {
  if (!rootId) return EMPTY_BOARD;
  return buildBoard(await loadRaw(rootId));
}

export async function loadOwnerDetail(
  id: string,
  rootId: string | null
): Promise<OwnerDetailData | null> {
  if (!rootId) return null;
  const board = buildBoard(await loadRaw(rootId), { includeUserId: id });
  const owner = board.people.find((p) => p.id === id);
  if (!owner) return null;
  return { owner, units: board.units, mergeCandidates: board.mergeCandidates };
}

// ── Writes ──────────────────────────────────────────────────────────────

// Mirror of the import seeder / PATCH /api/users/[id]: membership.weight is
// the owner's share of the whole community (unit share × owner share) scaled
// to an integer.
const WEIGHT_SCALE = 1_000_000n;

export interface CreateOwnerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  unitId?: string | null;
  shareNum: number;
  shareDen: number;
  role: UserRole;
  actorUserId: string;
  /** Current community root of the actor; the unit must belong to it. */
  rootId: string | null;
}

/**
 * Create an owner record without a login — the same "shell" shape the LV
 * import creates (src/lib/import/seed.ts): users row with password_hash NULL,
 * status 'pending', plus one active unit membership with the owner share.
 * The person gets access later through the existing claim flow
 * (createShellClaim → /claim/[token]) or by merging a self-registration.
 */
export async function createShellOwner(
  input: CreateOwnerInput
): Promise<{ ok: true; id: string } | { ok: false; error: CreateOwnerErrorCode }> {
  const name = input.name.trim();
  if (!name || name.length > 255) return { ok: false, error: "name_required" };

  const email = input.email?.trim().toLowerCase() || null;
  if (email && (!email.includes("@") || email.length > 254)) {
    return { ok: false, error: "invalid_email" };
  }
  const phone = input.phone?.trim() || null;

  if (!ROLES.includes(input.role)) return { ok: false, error: "invalid_role" };

  const rootId = input.rootId;
  if (!rootId) return { ok: false, error: "unit_not_found" };

  const unitId = input.unitId || null;
  if (!unitId && input.role === "owner") return { ok: false, error: "unit_required" };

  // Owner share and voting weight only mean something for an owner on a
  // unit. The columns are NOT NULL (default 1/1, weight 1) — no schema
  // change here — so other roles simply keep the column defaults.
  const isOwner = input.role === "owner";
  const { shareNum, shareDen } = isOwner ? input : { shareNum: 1, shareDen: 1 };
  if (
    !Number.isInteger(shareNum) ||
    !Number.isInteger(shareDen) ||
    shareNum <= 0 ||
    shareDen <= 0 ||
    shareNum > shareDen
  ) {
    return { ok: false, error: "invalid_share" };
  }

  if (email) {
    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (conflict) return { ok: false, error: "email_taken" };
  }

  let weight = 1;
  if (unitId) {
    const [unit] = await db
      .select({
        id: entities.id,
        num: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
        den: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.id, unitId),
          eq(entities.kind, "unit"),
          eq(entities.rootId, rootId),
          isNull(entities.archivedAt)
        )
      )
      .limit(1);
    if (!unit) return { ok: false, error: "unit_not_found" };
    const unitShare =
      unit.num != null && unit.den != null && unit.den !== 0
        ? rational(unit.num, unit.den)
        : rational(1, 1);
    const w = mul(unitShare, rational(shareNum, shareDen));
    weight = Number((w.num * WEIGHT_SCALE) / w.den);
  }

  try {
    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          name,
          email,
          phone,
          passwordHash: null,
          role: input.role,
          platformRole: "member",
          isActive: true,
          status: "pending",
        })
        .returning({ id: users.id });

      // Without a unit the person is attached to the community root, so they
      // stay inside this community (scoped lists, listUserRoots, and
      // getUserPrimaryRole resolves their real role instead of "owner").
      const entityId = unitId ?? rootId;
      await tx.insert(memberships).values({
        userId: created.id,
        entityId,
        role: input.role,
        ...(isOwner && unitId
          ? { weight, ownerUnitShareNumerator: shareNum, ownerUnitShareDenominator: shareDen }
          : {}),
        status: "active",
      });
      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "membership.create",
        entityId,
        afterJson: JSON.stringify({
          userId: created.id,
          role: input.role,
          ...(isOwner && unitId ? { ownerUnitShare: `${shareNum}/${shareDen}` } : {}),
          source: "owners.add",
        }),
      });
      return created.id;
    });
    return { ok: true, id };
  } catch (err) {
    // Unique e-mail race between the check above and the insert.
    console.error("[owners] createShellOwner failed", err);
    return { ok: false, error: "failed" };
  }
}

/**
 * Withdraw every open claim invitation for a shell owner. The tokens stop
 * working (claim and register only accept status='pending'); the owner falls
 * back to "Nemá účet" and can be invited again.
 */
export async function revokeShellInvitations(
  shellUserId: string,
  rootId: string | null
): Promise<number> {
  if (!rootId || !(await isUserInRoot(shellUserId, rootId))) return 0;
  const rows = await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(
      and(eq(invitations.targetShellUserId, shellUserId), eq(invitations.status, "pending"))
    )
    .returning({ id: invitations.id });
  return rows.length;
}

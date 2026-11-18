import "server-only";

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  boardMembers,
  directoryEntries,
  emailVerifications,
  entityAuditLog,
  invitations,
  mcpPendingActions,
  memberships,
  notificationPreferences,
  oauthAuthorizationCodes,
  oauthTokens,
  pushSubscriptions,
  userMerges,
  users,
  webauthnCredentials,
} from "@/db/schema";
import { ballots, mandates } from "@modules/voting/src/db/schema";
import { USER_FK_REGISTRY, registryKey, type UserFkEntry } from "@/lib/user-fk-registry";
import { countUserFkRows, entriesWithRows } from "@/lib/user-fk-registry.server";
import { finalizePlan, retainedHistoryLines, type Tx } from "@/lib/ownership.server";
import { todayIso, type ImpactLine, type ImpactPlan, type LifecycleResult } from "@/lib/ownership";

// BYT-20261118-007 — account merge (real ↔ real, and the shell → account
// claim path), anonymise and hard delete, all driven by the user-FK registry
// (src/lib/user-fk-registry.ts). The merged-away account is NEVER deleted:
// it becomes a tombstone (merged_into_user_id), PII cleared, login blocked,
// and a user_merges alias row records the move.
//
// No undo (TODO(decision) confirmed: tombstone + user_merges.impact_json are
// kept for manual repair). One transaction per action; any blocker rolls back.

type Exec = typeof db | Tx;

function ident(name: string) {
  return sql.identifier(name);
}

// ── Conflict discovery (read-only, shared by plan + execution) ─────────

interface MergeConflicts {
  openBallots: { voting: string; unit: string }[];
  closedDuplicateBallots: { loserBallotId: string; voting: string; unit: string }[];
  membershipOverlap: { loserMembershipId: string; unit: string }[];
  selfMandates: { mandateId: string; voting: string; open: boolean }[];
}

async function findMergeConflicts(exec: Exec, fromId: string, intoId: string): Promise<MergeConflicts> {
  const ballotRes = await exec.execute(sql`
    SELECT l.id AS loser_id, v.title AS voting, v.status AS status,
           coalesce(e.data->>'flat_number', e.name) AS unit
    FROM mod_voting_ballots l
    JOIN mod_voting_ballots s
      ON s.voting_id = l.voting_id AND s.entity_id = l.entity_id AND s.owner_id = ${intoId}
    JOIN mod_voting_votings v ON v.id = l.voting_id
    JOIN entities e ON e.id = l.entity_id
    WHERE l.owner_id = ${fromId}
  `);
  const ballotRows = (ballotRes as unknown as {
    rows: { loser_id: string; voting: string; status: string; unit: string }[];
  }).rows;

  const memRes = await exec.execute(sql`
    SELECT l.id AS loser_id, coalesce(e.data->>'flat_number', e.name) AS unit
    FROM memberships l
    JOIN memberships s ON s.entity_id = l.entity_id AND s.user_id = ${intoId} AND s.valid_to IS NULL
    JOIN entities e ON e.id = l.entity_id
    WHERE l.user_id = ${fromId} AND l.valid_to IS NULL
  `);
  const memRows = (memRes as unknown as { rows: { loser_id: string; unit: string }[] }).rows;

  // Mandates that become survivor → survivor after re-pointing.
  const mandRes = await exec.execute(sql`
    SELECT m.id AS id, v.title AS voting, v.status AS status
    FROM mod_voting_mandates m
    JOIN mod_voting_votings v ON v.id = m.voting_id
    WHERE (m.from_owner_id = ${fromId} AND m.to_owner_id IN (${fromId}, ${intoId}))
       OR (m.to_owner_id = ${fromId} AND m.from_owner_id = ${intoId})
  `);
  const mandRows = (mandRes as unknown as { rows: { id: string; voting: string; status: string }[] }).rows;

  return {
    openBallots: ballotRows
      .filter((b) => b.status !== "closed")
      .map((b) => ({ voting: b.voting, unit: b.unit })),
    closedDuplicateBallots: ballotRows
      .filter((b) => b.status === "closed")
      .map((b) => ({ loserBallotId: b.loser_id, voting: b.voting, unit: b.unit })),
    membershipOverlap: memRows.map((m) => ({ loserMembershipId: m.loser_id, unit: m.unit })),
    selfMandates: mandRows.map((m) => ({ mandateId: m.id, voting: m.voting, open: m.status !== "closed" })),
  };
}

// ── Merge plan ─────────────────────────────────────────────────────────

interface MergeUsersRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  hasPassword: boolean;
  mergedInto: string | null;
  anonymizedAt: Date | null;
}

async function loadPair(exec: Exec, fromId: string, intoId: string, lock = false) {
  const q = exec
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`,
      mergedInto: users.mergedIntoUserId,
      anonymizedAt: users.anonymizedAt,
    })
    .from(users)
    .where(inArray(users.id, [fromId, intoId]))
    .orderBy(users.id);
  const rows: MergeUsersRow[] = lock ? await q.for("update") : await q;
  return { from: rows.find((r) => r.id === fromId), into: rows.find((r) => r.id === intoId) };
}

function groupLines(items: { entry: UserFkEntry; count: number }[]): ImpactLine[] {
  const by = new Map<string, ImpactLine>();
  for (const { entry, count } of items) {
    const cur = by.get(entry.group) ?? { group: entry.group, key: entry.group, count: 0 };
    cur.count += count;
    by.set(entry.group, cur);
  }
  return [...by.values()];
}

async function buildMergePlan(
  exec: Exec,
  from: MergeUsersRow,
  into: MergeUsersRow,
  actorUserId: string
): Promise<{ plan: ImpactPlan; conflicts: MergeConflicts }> {
  const counts = await countUserFkRows(from.id, exec);
  const conflicts = await findMergeConflicts(exec, from.id, into.id);
  const moved = entriesWithRows(counts, (e) => e.merge.kind !== "drop");
  const dropped = entriesWithRows(counts, (e) => e.merge.kind === "drop");

  const blockers: ImpactPlan["blockers"] = [];
  if (from.id === actorUserId) blockers.push({ code: "self_action" });
  if (from.mergedInto || into.mergedInto || from.anonymizedAt || into.anonymizedAt) {
    blockers.push({ code: "merge_tombstone" });
  }
  for (const b of conflicts.openBallots) {
    blockers.push({ code: "merge_conflict_open_ballot", params: { voting: b.voting, unit: b.unit } });
  }

  const warnings: ImpactPlan["warnings"] = [{ code: "no_undo" }];
  for (const b of conflicts.closedDuplicateBallots) {
    warnings.push({ code: "merge_closed_duplicate_ballot", params: { voting: b.voting, unit: b.unit } });
  }
  for (const m of conflicts.selfMandates) {
    warnings.push({ code: "merge_self_mandate", params: { voting: m.voting } });
  }
  for (const m of conflicts.membershipOverlap) {
    warnings.push({ code: "merge_membership_overlap", params: { unit: m.unit } });
  }

  const plan = finalizePlan({
    action: "merge",
    archive: [{ group: "ownership_periods", key: "ownershipPeriods", count: conflicts.membershipOverlap.length }],
    move: groupLines(moved),
    keep: [
      { group: "voting", key: "duplicateBallotsOnTombstone", count: conflicts.closedDuplicateBallots.length },
      { group: "account", key: "tombstone", count: 1 },
    ],
    destroy: [
      ...groupLines(dropped),
      { group: "account", key: "contactData", count: from.email || from.phone || from.hasPassword ? 1 : 0 },
    ],
    blockers,
    warnings,
    summary: { from: from.name, into: into.name },
  });
  return { plan, conflicts };
}

export async function planMerge(
  fromId: string,
  intoId: string,
  actorUserId: string
): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  if (fromId === intoId) return { ok: false, error: "merge_same_user" };
  const { from, into } = await loadPair(db, fromId, intoId);
  if (!from || !into) return { ok: false, error: "not_found" };
  const { plan } = await buildMergePlan(db, from, into, actorUserId);
  return { ok: true, plan };
}

/**
 * Survivor default (TODO(decision) answered by Filip): the account with a
 * password; then the most recent login. The user can switch in the dialog.
 */
export async function suggestSurvivor(aId: string, bId: string): Promise<string> {
  const rows = await db
    .select({ id: users.id, hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(inArray(users.id, [aId, bId]));
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  if (!a || !b) return aId;
  if (a.hasPassword !== b.hasPassword) return a.hasPassword ? aId : bId;
  const la = a.lastLoginAt?.getTime() ?? 0;
  const lb = b.lastLoginAt?.getTime() ?? 0;
  return lb > la ? bId : aId;
}

// ── Merge execution ────────────────────────────────────────────────────

/**
 * Re-point every registry FK from `fromId` to `intoId` inside `tx`, applying
 * the conflict rules. Throws nothing on conflicts — the caller checked the
 * plan's blockers first. Returns per-entry counts actually moved.
 */
async function applyMergeTx(tx: Tx, fromId: string, intoId: string, conflicts: MergeConflicts, actorUserId: string) {
  const today = todayIso();

  // memberships: both current on the same unit → survivor keeps its row,
  // the loser's is ended ('merged'). Then every loser row moves (ended rows
  // may overlap — it was the same person).
  if (conflicts.membershipOverlap.length > 0) {
    await tx
      .update(memberships)
      .set({ status: "archived", validTo: sql`GREATEST(${today}::date, ${memberships.validFrom})`, endReason: "merged", endedById: actorUserId })
      .where(inArray(memberships.id, conflicts.membershipOverlap.map((m) => m.loserMembershipId)));
  }
  await tx.update(memberships).set({ userId: intoId }).where(eq(memberships.userId, fromId));

  // ballots: closed-voting duplicate stays on the tombstone, flagged.
  // TODO(decision): the spec asks for the newer-confirmed ballot on the
  // survivor; swapping two ballots under the (voting, unit, owner) unique key
  // needs a third owner id, so the SURVIVOR's ballot is kept as-is and the
  // loser's is flagged disputed. Recorded results are not recomputed.
  const dupIds = conflicts.closedDuplicateBallots.map((b) => b.loserBallotId);
  if (dupIds.length > 0) {
    await tx
      .update(ballots)
      .set({ disputed: true, disputeNote: "merged_duplicate" })
      .where(inArray(ballots.id, dupIds));
  }
  // hash_owner_id keeps itemAuditHash verifiable (hash input = original owner).
  await tx.execute(sql`
    UPDATE mod_voting_ballots
    SET hash_owner_id = COALESCE(hash_owner_id, owner_id), owner_id = ${intoId}
    WHERE owner_id = ${fromId}
      ${dupIds.length > 0 ? sql`AND id NOT IN (${sql.join(dupIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
  `);

  // mandates: re-point, then deactivate self-mandates of open votings
  // (closed ones are kept and flagged on the impact screen).
  await tx.update(mandates).set({ fromOwnerId: intoId }).where(eq(mandates.fromOwnerId, fromId));
  await tx.update(mandates).set({ toOwnerId: intoId }).where(eq(mandates.toOwnerId, fromId));
  const openSelf = conflicts.selfMandates.filter((m) => m.open).map((m) => m.mandateId);
  if (openSelf.length > 0) {
    await tx.update(mandates).set({ isActive: false }).where(inArray(mandates.id, openSelf));
  }

  // board_members: same entity + role, both active → survivor's row stays,
  // the loser's is ended (isActive=false). Then all rows move.
  await tx.execute(sql`
    UPDATE board_members l SET is_active = false
    WHERE l.user_id = ${fromId} AND l.is_active
      AND EXISTS (SELECT 1 FROM board_members s WHERE s.user_id = ${intoId} AND s.entity_id = l.entity_id AND s.role = l.role AND s.is_active)
  `);
  await tx.update(boardMembers).set({ userId: intoId }).where(eq(boardMembers.userId, fromId));

  // event_rsvps (post, user unique): keep the more recent answer on the
  // survivor; the other stays on the tombstone. A newer loser answer is
  // copied onto the survivor's row and the older one onto the loser's row.
  await tx.execute(sql`
    WITH pairs AS (
      SELECT l.id AS lid, s.id AS sid,
             l.status AS ls, l.source AS lsrc, l.recorded_by_id AS lrec, l.updated_at AS lup,
             s.status AS ss, s.source AS ssrc, s.recorded_by_id AS srec, s.updated_at AS sup
      FROM event_rsvps l JOIN event_rsvps s ON s.post_id = l.post_id AND s.user_id = ${intoId}
      WHERE l.user_id = ${fromId} AND l.updated_at > s.updated_at
    ),
    upd_s AS (
      UPDATE event_rsvps r SET status = p.ls, source = p.lsrc, recorded_by_id = p.lrec, updated_at = p.lup
      FROM pairs p WHERE r.id = p.sid RETURNING r.id
    )
    UPDATE event_rsvps r SET status = p.ss, source = p.ssrc, recorded_by_id = p.srec, updated_at = p.sup
    FROM pairs p WHERE r.id = p.lid
  `);
  await tx.execute(sql`
    UPDATE event_rsvps l SET user_id = ${intoId}
    WHERE l.user_id = ${fromId}
      AND NOT EXISTS (SELECT 1 FROM event_rsvps s WHERE s.user_id = ${intoId} AND s.post_id = l.post_id)
  `);

  // mod_voting_attendance (voting, owner unique): both checked in → the
  // survivor's row stays, the loser's stays on the tombstone (evidence).
  // TODO(decision): spec says keep the EARLIEST check-in on the survivor;
  // swapping rows under the unique key is deferred like ballots.
  await tx.execute(sql`
    UPDATE mod_voting_attendance l SET owner_id = ${intoId}
    WHERE l.owner_id = ${fromId}
      AND NOT EXISTS (SELECT 1 FROM mod_voting_attendance s WHERE s.owner_id = ${intoId} AND s.voting_id = l.voting_id)
  `);

  // Everything else straight from the registry.
  for (const e of USER_FK_REGISTRY) {
    const t = ident(e.table);
    const c = ident(e.column);
    switch (e.merge.kind) {
      case "custom":
        break;
      case "drop":
        await tx.execute(sql`DELETE FROM ${t} WHERE ${c} = ${fromId}`);
        break;
      case "single-survivor":
        await tx.execute(
          sql`DELETE FROM ${t} WHERE ${c} = ${fromId} AND EXISTS (SELECT 1 FROM ${t} s WHERE s.${c} = ${intoId})`
        );
        await tx.execute(sql`UPDATE ${t} SET ${c} = ${intoId} WHERE ${c} = ${fromId}`);
        break;
      case "repoint-dedupe": {
        const same = sql.join(
          e.merge.uniqueWith.map((u) => sql`s.${ident(u)} IS NOT DISTINCT FROM l.${ident(u)}`),
          sql` AND `
        );
        await tx.execute(
          sql`DELETE FROM ${t} l WHERE l.${c} = ${fromId} AND EXISTS (SELECT 1 FROM ${t} s WHERE s.${c} = ${intoId} AND ${same})`
        );
        await tx.execute(sql`UPDATE ${t} SET ${c} = ${intoId} WHERE ${c} = ${fromId}`);
        break;
      }
      case "repoint":
        await tx.execute(sql`UPDATE ${t} SET ${c} = ${intoId} WHERE ${c} = ${fromId}`);
        break;
    }
  }
}

/** Clear the loser's PII and turn it into a tombstone pointing at the survivor. */
async function tombstoneTx(tx: Tx, from: MergeUsersRow, into: MergeUsersRow) {
  await tx
    .update(users)
    .set({
      email: null,
      phone: null,
      passwordHash: null,
      isActive: false,
      mergedIntoUserId: into.id,
      mergedAt: new Date(),
    })
    .where(eq(users.id, from.id));
  // Survivor without contact data inherits the loser's (after the loser's
  // e-mail was cleared, so the unique index cannot collide).
  const fill: { email?: string; phone?: string } = {};
  if (!into.email && from.email) fill.email = from.email;
  if (!into.phone && from.phone) fill.phone = from.phone;
  if (Object.keys(fill).length > 0) await tx.update(users).set(fill).where(eq(users.id, into.id));
}

/**
 * Merge `fromId` (the duplicate) into `intoId` (the survivor). The confirmed
 * plan hash must match a fresh plan computed in the same transaction.
 */
export async function mergeUsers(
  fromId: string,
  intoId: string,
  actorUserId: string,
  confirmedHash: string
): Promise<LifecycleResult> {
  if (fromId === intoId) return { ok: false, error: "merge_same_user" };
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const { from, into } = await loadPair(tx, fromId, intoId, true);
      if (!from || !into) return { ok: false as const, error: "not_found" as const };
      const { plan, conflicts } = await buildMergePlan(tx, from, into, actorUserId);
      if (plan.hash !== confirmedHash) return { ok: false as const, error: "plan_stale" as const, plan };
      if (plan.blockers.length > 0) {
        const code = plan.blockers[0].code;
        return {
          ok: false as const,
          error: code === "merge_conflict_open_ballot" ? ("merge_conflict_open_ballot" as const) : code === "self_action" ? ("self_action" as const) : ("merge_tombstone" as const),
          plan,
        };
      }
      await applyMergeTx(tx, fromId, intoId, conflicts, actorUserId);
      await tombstoneTx(tx, from, into);
      await tx.insert(userMerges).values({ fromUserId: fromId, intoUserId: intoId, impactJson: plan, actorUserId });
      await tx.insert(entityAuditLog).values({
        actorUserId,
        action: "user.merge",
        entityId: null,
        beforeJson: JSON.stringify({ fromUserId: fromId, fromName: from.name }),
        afterJson: JSON.stringify({ intoUserId: intoId, planHash: plan.hash }),
      });
      return { ok: true as const };
    });
  } catch (err) {
    console.error("[user-merge] merge failed", err);
    return { ok: false, error: "failed" };
  }
}

/**
 * Shell → account claim path (BYT-20260512-001), now on the registry so no
 * FK is missed (accounting authorship, passkeys, MCP …). Runs inside the
 * caller's transaction. The shell row is deleted when nothing retained is
 * left on it, otherwise it stays as a tombstone (closed-voting duplicate
 * ballot). Returns null on success or the blocking code.
 */
export async function mergeShellTx(
  tx: Tx,
  shellId: string,
  targetId: string,
  actorUserId: string
): Promise<{ blocked: string | null; moved: number; ended: number }> {
  const conflicts = await findMergeConflicts(tx, shellId, targetId);
  if (conflicts.openBallots.length > 0) return { blocked: "merge_conflict_open_ballot", moved: 0, ended: 0 };
  const [{ n: moved }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.userId, shellId));
  await applyMergeTx(tx, shellId, targetId, conflicts, actorUserId);
  const left = entriesWithRows(await countUserFkRows(shellId, tx), (e) => e.retained);
  if (left.length === 0) {
    await tx.delete(users).where(eq(users.id, shellId));
  } else {
    const { from, into } = await loadPair(tx, shellId, targetId);
    if (from && into) {
      await tombstoneTx(tx, from, into);
      await tx.insert(userMerges).values({
        fromUserId: shellId,
        intoUserId: targetId,
        impactJson: { source: "shell_claim", left: left.map((l) => registryKey(l.entry)) },
        actorUserId,
      });
    }
  }
  return { blocked: null, moved: moved - conflicts.membershipOverlap.length, ended: conflicts.membershipOverlap.length };
}

// ── Hard delete ────────────────────────────────────────────────────────

async function buildHardDeletePlan(exec: Exec, userId: string, actorUserId: string, name: string) {
  const counts = await countUserFkRows(userId, exec);
  // Ended ownership periods are history; a CURRENT membership of an account
  // created by mistake is removed with it (shown under "Zmaže sa").
  const [mem] = await exec
    .select({
      current: sql<number>`count(*) FILTER (WHERE ${memberships.validTo} IS NULL)::int`,
      ended: sql<number>`count(*) FILTER (WHERE ${memberships.validTo} IS NOT NULL)::int`,
    })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const retained = entriesWithRows(counts, (e) => e.retained && e.table !== "memberships");
  const keepLines = groupLines(retained);
  if ((mem?.ended ?? 0) > 0) keepLines.push({ group: "ownership_periods", key: "ownershipPeriods", count: mem.ended });
  const blockers: ImpactPlan["blockers"] = [];
  if (userId === actorUserId) blockers.push({ code: "self_action" });
  if (keepLines.length > 0) blockers.push({ code: "user_has_history" });
  const destroyed = entriesWithRows(counts, (e) => !e.retained);
  return finalizePlan({
    action: "hard_delete",
    archive: [],
    move: [],
    keep: keepLines,
    destroy: [
      ...groupLines(destroyed),
      { group: "ownership_periods", key: "currentMemberships", count: mem?.current ?? 0 },
      { group: "account", key: "account", count: 1 },
    ],
    blockers,
    warnings: [],
    summary: { name },
  });
}

export async function planHardDelete(userId: string, actorUserId: string): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { ok: false, error: "not_found" };
  return { ok: true, plan: await buildHardDeletePlan(db, userId, actorUserId, u.name) };
}

/** Delete only when the plan keeps nothing; never 500s on an FK. */
export async function hardDeleteUser(userId: string, actorUserId: string, confirmedHash: string): Promise<LifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).for("update");
      if (!u) return { ok: false as const, error: "not_found" as const };
      const plan = await buildHardDeletePlan(tx, userId, actorUserId, u.name);
      if (plan.blockers.some((b) => b.code === "self_action")) return { ok: false as const, error: "self_action" as const, plan };
      if (plan.blockers.length > 0) return { ok: false as const, error: "user_has_history" as const, plan };
      if (plan.hash !== confirmedHash) return { ok: false as const, error: "plan_stale" as const, plan };
      // Memberships cascade; credentials / settings cascade or set null.
      await tx.delete(users).where(eq(users.id, userId));
      await tx.insert(entityAuditLog).values({
        actorUserId,
        action: "user.hard_delete",
        entityId: null,
        beforeJson: JSON.stringify({ userId }),
      });
      return { ok: true as const };
    });
  } catch (err) {
    // 23503: an FK the registry does not know yet (new table) — refuse, never 500.
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) === "23503") return { ok: false, error: "user_has_history" };
    console.error("[user-merge] hard delete failed", err);
    return { ok: false, error: "failed" };
  }
}

// ── Anonymise (GDPR Art. 17 with Art. 17(3)(b)/(e) retention) ──────────

const ANONYMIZE_DROP: { key: string; table: Parameters<typeof db.delete>[0]; col: SQL }[] = [
  { key: "passkeys", table: webauthnCredentials, col: sql`${webauthnCredentials.userId}` },
  { key: "pushSubscriptions", table: pushSubscriptions, col: sql`${pushSubscriptions.userId}` },
  { key: "oauthTokens", table: oauthTokens, col: sql`${oauthTokens.userId}` },
  { key: "oauthCodes", table: oauthAuthorizationCodes, col: sql`${oauthAuthorizationCodes.userId}` },
  { key: "mcpPending", table: mcpPendingActions, col: sql`${mcpPendingActions.userId}` },
  { key: "emailVerifications", table: emailVerifications, col: sql`${emailVerifications.userId}` },
  { key: "directoryEntry", table: directoryEntries, col: sql`${directoryEntries.userId}` },
  { key: "notificationPreferences", table: notificationPreferences, col: sql`${notificationPreferences.userId}` },
  { key: "openInvitations", table: invitations, col: sql`${invitations.targetShellUserId}` },
];

async function buildAnonymizePlan(exec: Exec, userId: string, actorUserId: string) {
  const [u] = await exec
    .select({ name: users.name, email: users.email, phone: users.phone, hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`, anonymizedAt: users.anonymizedAt, mergedInto: users.mergedIntoUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;
  const counts = await countUserFkRows(userId, exec);
  const regKey: Record<string, string> = {
    passkeys: "webauthn_credentials.user_id",
    pushSubscriptions: "push_subscriptions.user_id",
    oauthTokens: "oauth_tokens.user_id",
    oauthCodes: "oauth_authorization_codes.user_id",
    mcpPending: "mcp_pending_actions.user_id",
    emailVerifications: "email_verifications.user_id",
    directoryEntry: "directory_entries.user_id",
    notificationPreferences: "notification_preferences.user_id",
    openInvitations: "invitations.target_shell_user_id",
  };
  const [cur] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.validTo)));
  const blockers: ImpactPlan["blockers"] = [];
  if (userId === actorUserId) blockers.push({ code: "self_action" });
  if ((cur?.n ?? 0) > 0) blockers.push({ code: "anonymize_has_current_ownership" });
  if (u.mergedInto) blockers.push({ code: "merge_tombstone" });
  const keep = await retainedHistoryLines(userId, exec);
  const [ended] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), sql`${memberships.validTo} IS NOT NULL`));
  keep.push({ group: "ownership_periods", key: "ownershipPeriods", count: ended?.n ?? 0 });
  const plan = finalizePlan({
    action: "anonymize",
    archive: [],
    move: [],
    keep,
    destroy: [
      { group: "account", key: "contactData", count: u.email || u.phone || u.hasPassword ? 1 : 0 },
      ...ANONYMIZE_DROP.map((d) => ({ group: "credentials" as const, key: d.key, count: counts.get(regKey[d.key]) ?? 0 })),
    ],
    blockers,
    warnings: [],
    summary: { name: u.name },
  });
  return { plan, already: !!u.anonymizedAt, name: u.name };
}

export async function planAnonymize(userId: string, actorUserId: string): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const r = await buildAnonymizePlan(db, userId, actorUserId);
  if (!r) return { ok: false, error: "not_found" };
  if (r.already) return { ok: false, error: "already_anonymized" };
  return { ok: true, plan: r.plan };
}

/**
 * Remove contact + convenience data; keep statutory records (ownership
 * periods, ballots, mandates, attendance, accounting attribution, consent
 * history). The name stays on the row for the statutory outputs (minutes,
 * karta bytu) — the account no longer appears in owner-facing lists because
 * it has no current membership (precondition) and no directory entry.
 * TODO(decision): legal-copy sign-off on retention horizons before release;
 * "Pseudonymizovať po uplynutí lehoty" is not implemented yet.
 */
export async function anonymizeUser(userId: string, actorUserId: string, confirmedHash: string): Promise<LifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      const r = await buildAnonymizePlan(tx, userId, actorUserId);
      if (!r) return { ok: false as const, error: "not_found" as const };
      if (r.already) return { ok: false as const, error: "already_anonymized" as const };
      if (r.plan.blockers.length > 0) {
        const c = r.plan.blockers[0].code;
        return { ok: false as const, error: c === "self_action" ? ("self_action" as const) : c === "merge_tombstone" ? ("merge_tombstone" as const) : ("anonymize_has_current_ownership" as const), plan: r.plan };
      }
      if (r.plan.hash !== confirmedHash) return { ok: false as const, error: "plan_stale" as const, plan: r.plan };
      for (const d of ANONYMIZE_DROP) await tx.delete(d.table).where(sql`${d.col} = ${userId}`);
      await tx
        .update(users)
        .set({ email: null, phone: null, passwordHash: null, isActive: false, emailVerifiedAt: null, anonymizedAt: new Date() })
        .where(eq(users.id, userId));
      // No PII in the audit row (that is the point of the action).
      await tx.insert(entityAuditLog).values({
        actorUserId,
        action: "user.anonymize",
        entityId: null,
        beforeJson: JSON.stringify({ userId }),
        afterJson: JSON.stringify({ planHash: r.plan.hash }),
      });
      return { ok: true as const };
    });
  } catch (err) {
    console.error("[user-merge] anonymize failed", err);
    return { ok: false, error: "failed" };
  }
}

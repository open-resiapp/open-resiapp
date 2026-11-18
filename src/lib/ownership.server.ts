import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { UNIT_HOLDER_ROLES, type UnitHolderRole } from "@/lib/role-options";

import { db } from "@/db";
import {
  entities,
  entityAuditLog,
  memberships,
  mcpPendingActions,
  oauthTokens,
  ownershipTransfers,
  pushSubscriptions,
  users,
} from "@/db/schema";
import { ballots, votings } from "@modules/voting/src/db/schema";
import { accountingPeriods, feeAssessments } from "@modules/accounting/src/db/schema";
import { add, isOne, rational, type Rational } from "@/lib/rational";
import { unitOwnerWeight } from "@/lib/owners-board.server";
import { countUserFkRows, entriesWithRows } from "@/lib/user-fk-registry.server";
import {
  TRANSFER_KINDS,
  isIsoDate,
  todayIso,
  type EndReason,
  type ImpactLine,
  type ImpactPlan,
  type LifecycleErrorCode,
  type LifecycleResult,
  type OwnershipPeriod,
  type TransferKind,
  type UnitOwnerPeriod,
} from "@/lib/ownership";

// BYT-20261118-007 — ownership history: periods, as-of reads, end / transfer /
// remove-from-community / restore. Every mutation is planned first by a
// read-only `planX()` that the mutation re-runs inside its transaction, so the
// impact screen and the execution cannot drift (`plan_stale`).
//
// Multi-replica safe: no DDL, no background work, short transactions, row
// locks taken in one order (memberships of the unit / user, then inserts).

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

// ── As-of reads ─────────────────────────────────────────────────────────

/**
 * Membership valid ON `date` (YYYY-MM-DD or a SQL date expression):
 * valid_from <= date AND (valid_to IS NULL OR valid_to > date).
 * valid_to is the first day the person is NO LONGER the owner (= the
 * transfer's effective date, which belongs to the buyer).
 */
export function activeOn(date: string | SQL): SQL {
  const d = typeof date === "string" ? sql`${date}::date` : date;
  return sql`(${memberships.validFrom} <= ${d} AND (${memberships.validTo} IS NULL OR ${memberships.validTo} > ${d}))`;
}

/** The (user, unit) membership valid on `date`, or null. */
export async function membershipAt(entityId: string, userId: string, date: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.entityId, entityId), eq(memberships.userId, userId), activeOn(date)))
    .orderBy(desc(memberships.validFrom))
    .limit(1);
  return row ?? null;
}

/**
 * Owner user ids of a unit on `date` (read-only; for accounting "debt follows
 * the person" reads). Ids of merged-away accounts are not stored here — merge
 * re-points memberships to the survivor.
 */
export async function unitOwnersAt(entityId: string, date: string): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.entityId, entityId), inArray(memberships.role, UNIT_HOLDER_ROLES), activeOn(date)));
  return [...new Set(rows.map((r) => r.userId))];
}

/** Resolve user ids frozen in snapshots (jsonb, hashes) through merge aliases. */
export async function resolveMergedUserIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map(ids.map((id) => [id, id]));
  let pending = [...new Set(ids)];
  // Follow merged_into chains (A→B→C); bounded by the number of hops.
  for (let hop = 0; hop < 8 && pending.length > 0; hop++) {
    const rows = await db
      .select({ id: users.id, into: users.mergedIntoUserId })
      .from(users)
      .where(inArray(users.id, pending));
    const next: string[] = [];
    for (const r of rows) {
      if (!r.into) continue;
      for (const [orig, cur] of out) if (cur === r.id) out.set(orig, r.into);
      next.push(r.into);
    }
    pending = next;
  }
  return out;
}

function unitLabelExpr() {
  return sql<string>`coalesce(${entities.data}->>'flat_number', ${entities.name})`;
}

/** Every ownership period of a user inside the community `rootId`, newest first. */
export async function loadOwnershipHistory(userId: string, rootId: string): Promise<OwnershipPeriod[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      unitId: entities.id,
      unitLabel: unitLabelExpr(),
      role: memberships.role,
      shareNum: memberships.ownerUnitShareNumerator,
      shareDen: memberships.ownerUnitShareDenominator,
      validFrom: memberships.validFrom,
      validTo: memberships.validTo,
      endReason: memberships.endReason,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(and(eq(memberships.userId, userId), eq(entities.rootId, rootId)))
    .orderBy(sql`${memberships.validTo} IS NULL DESC`, desc(memberships.validFrom));
  return rows.map((r) => ({ ...r, endReason: (r.endReason as EndReason | null) ?? null }));
}

/**
 * Owners of one unit of `rootId`. `includeFormer=false` returns EXACTLY the
 * current memberships (valid_to IS NULL); true adds the ended periods.
 */
export async function loadUnitOwnerPeriods(
  rootId: string,
  unitId: string,
  includeFormer: boolean
): Promise<{ unitLabel: string; owners: UnitOwnerPeriod[] } | null> {
  const [unit] = await db
    .select({ id: entities.id, label: unitLabelExpr() })
    .from(entities)
    .where(and(eq(entities.id, unitId), eq(entities.rootId, rootId), eq(entities.kind, "unit")))
    .limit(1);
  if (!unit) return null;
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      name: users.name,
      role: memberships.role,
      shareNum: memberships.ownerUnitShareNumerator,
      shareDen: memberships.ownerUnitShareDenominator,
      validFrom: memberships.validFrom,
      validTo: memberships.validTo,
      endReason: memberships.endReason,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.entityId, unitId),
        includeFormer ? sql`true` : isNull(memberships.validTo)
      )
    )
    .orderBy(sql`${memberships.validTo} IS NULL DESC`, desc(memberships.validFrom), asc(users.name));
  return {
    unitLabel: unit.label,
    owners: rows.map((r) => ({ ...r, endReason: (r.endReason as EndReason | null) ?? null })),
  };
}

// ── Plan helpers ────────────────────────────────────────────────────────

export function hashPlan(plan: Omit<ImpactPlan, "hash">): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex").slice(0, 32);
}

export function finalizePlan(plan: Omit<ImpactPlan, "hash">): ImpactPlan {
  const strip = (l: ImpactLine[]) => l.filter((x) => x.count > 0);
  const clean = {
    ...plan,
    archive: strip(plan.archive),
    move: strip(plan.move),
    keep: strip(plan.keep),
    destroy: strip(plan.destroy),
  };
  return { ...clean, hash: hashPlan(clean) };
}

/** Retained history of a user, grouped (the "Zostáva" lines). */
export async function retainedHistoryLines(userId: string, exec: Exec = db): Promise<ImpactLine[]> {
  const counts = await countUserFkRows(userId, exec);
  const byGroup = new Map<string, ImpactLine>();
  for (const { entry, count } of entriesWithRows(counts, (e) => e.retained && e.table !== "memberships")) {
    const key = entry.group;
    const cur = byGroup.get(key) ?? { group: entry.group, key, count: 0 };
    cur.count += count;
    byGroup.set(key, cur);
  }
  return [...byGroup.values()];
}

function sumShares(rows: { num: number; den: number }[]): Rational {
  return rows.reduce<Rational>((acc, r) => add(acc, rational(r.num, r.den)), rational(0, 1));
}

/**
 * End memberships at `date` (status archived, valid_to, end_reason) — the
 * ONLY way an ownership stops. Never deletes. Returns ended ids.
 */
export async function endMembershipsTx(
  tx: Exec,
  membershipIds: string[],
  opts: { date: string; reason: EndReason; actorUserId: string | null; transferId?: string | null }
): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  // valid_to must be >= valid_from (CHECK): a correction on a membership
  // created later than `date` ends it on its own start day.
  const rows = await tx
    .update(memberships)
    .set({
      status: "archived",
      validTo: sql`GREATEST(${opts.date}::date, ${memberships.validFrom})`,
      endReason: opts.reason,
      endedById: opts.actorUserId,
      ...(opts.transferId ? { transferId: opts.transferId } : {}),
    })
    .where(and(inArray(memberships.id, membershipIds), isNull(memberships.validTo)))
    .returning({ id: memberships.id, entityId: memberships.entityId, userId: memberships.userId });
  return rows.map((r) => r.id);
}

// ── Transfer (sale / inheritance / gift / correction) ──────────────────

export interface TransferInput {
  rootId: string;
  unitId: string;
  sellerUserIds: string[];
  buyers: { userId: string; shareNum: number; shareDen: number }[];
  /** "Nový vlastník": owner records (shell, no login) created in the same tx. */
  newBuyers?: { name: string; shareNum: number; shareDen: number }[];
  date: string;
  kind: TransferKind;
  note?: string | null;
}

type TransferCtx = {
  unitLabel: string;
  unitPath: string;
  sellerRows: { id: string; userId: string; name: string; validFrom: string; role: string }[];
  /** Role the buyers inherit: družstvo units are held by `member`, SVB units by `owner`. */
  holderRole: UnitHolderRole;
  buyerNames: string[];
};

async function validateTransfer(
  exec: Exec,
  input: TransferInput
): Promise<{ ok: true; ctx: TransferCtx } | { ok: false; error: LifecycleErrorCode }> {
  if (!isIsoDate(input.date)) return { ok: false, error: "transfer_date_invalid" };
  // TODO(decision): future-dated transfers are rejected — a pending
  // "from date X" state would need a scheduled flip (= background job).
  if (input.date > todayIso()) return { ok: false, error: "transfer_date_in_future" };
  if (!(TRANSFER_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "invalid_input" };
  const sellers = [...new Set(input.sellerUserIds)];
  if (sellers.length === 0) return { ok: false, error: "transfer_no_sellers" };
  const buyerIds = input.buyers.map((b) => b.userId);
  if (new Set(buyerIds).size !== buyerIds.length) return { ok: false, error: "transfer_buyer_invalid" };
  const newBuyers = input.newBuyers ?? [];
  if (newBuyers.some((b) => !b.name || !b.name.trim() || b.name.trim().length > 255)) {
    return { ok: false, error: "transfer_buyer_invalid" };
  }
  for (const b of [...input.buyers, ...newBuyers]) {
    if (
      !Number.isInteger(b.shareNum) ||
      !Number.isInteger(b.shareDen) ||
      b.shareNum <= 0 ||
      b.shareDen <= 0 ||
      b.shareNum > b.shareDen
    ) {
      return { ok: false, error: "invalid_share" };
    }
  }

  const [unit] = await exec
    .select({ id: entities.id, label: unitLabelExpr(), path: entities.path })
    .from(entities)
    .where(
      and(
        eq(entities.id, input.unitId),
        eq(entities.rootId, input.rootId),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    )
    .limit(1);
  if (!unit) return { ok: false, error: "not_found" };

  const current = await exec
    .select({
      id: memberships.id,
      userId: memberships.userId,
      name: users.name,
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
      validFrom: memberships.validFrom,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.entityId, input.unitId),
        inArray(memberships.role, UNIT_HOLDER_ROLES),
        isNull(memberships.validTo)
      )
    );

  const sellerRows = current.filter((m) => sellers.includes(m.userId));
  if (sellerRows.length !== sellers.length) return { ok: false, error: "transfer_seller_not_owner" };
  if (sellerRows.some((s) => s.validFrom > input.date)) return { ok: false, error: "transfer_date_before_start" };

  // A remaining co-owner who also buys must be listed as seller (+ buyer with
  // the new total share); otherwise two current rows would collide.
  const remaining = current.filter((m) => !sellers.includes(m.userId));
  if (remaining.some((m) => buyerIds.includes(m.userId))) {
    return { ok: false, error: "transfer_buyer_already_owner" };
  }

  let buyerNames: string[] = [];
  if (buyerIds.length > 0) {
    const buyerRows = await exec
      .select({ id: users.id, name: users.name, mergedInto: users.mergedIntoUserId, anonymizedAt: users.anonymizedAt })
      .from(users)
      .where(inArray(users.id, buyerIds));
    if (buyerRows.length !== buyerIds.length || buyerRows.some((b) => b.mergedInto || b.anonymizedAt)) {
      return { ok: false, error: "transfer_buyer_invalid" };
    }
    buyerNames = buyerRows.map((b) => b.name);
  }
  buyerNames = [...buyerNames, ...newBuyers.map((b) => b.name.trim())];

  const after = add(
    sumShares(remaining.map((m) => ({ num: m.num, den: m.den }))),
    sumShares([...input.buyers, ...newBuyers].map((b) => ({ num: b.shareNum, den: b.shareDen })))
  );
  if (!isOne(after)) return { ok: false, error: "share_sum_not_one" };

  return {
    ok: true,
    ctx: {
      unitLabel: unit.label,
      unitPath: unit.path,
      sellerRows: sellerRows.map((s) => ({ id: s.id, userId: s.userId, name: s.name, validFrom: s.validFrom, role: s.role })),
      holderRole: sellerRows.some((s) => s.role === "member") ? "member" : "owner",
      buyerNames,
    },
  };
}

async function buildTransferPlan(exec: Exec, input: TransferInput, ctx: TransferCtx): Promise<ImpactPlan> {
  const sellerIds = ctx.sellerRows.map((s) => s.userId);
  const warnings: ImpactPlan["warnings"] = [];

  // Ballots the seller cast for THIS unit on/after the (backdated) date.
  // TODO(decision): warn and keep — the seller was the registered owner at
  // cast time (spec Notes, to confirm with the T9 voting opinion).
  const sellerBallots = await exec
    .select({ title: votings.title, recordedAt: ballots.recordedAt })
    .from(ballots)
    .innerJoin(votings, eq(votings.id, ballots.votingId))
    .where(
      and(
        eq(ballots.entityId, input.unitId),
        inArray(ballots.ownerId, sellerIds),
        gte(ballots.recordedAt, sql`${input.date}::date`)
      )
    );
  for (const b of sellerBallots) {
    warnings.push({ code: "backdated_seller_ballot", params: { voting: b.title } });
  }

  // Votings that ran after the date covering this unit: the buyer could not vote.
  const missed = await exec
    .select({ title: votings.title })
    .from(votings)
    .innerJoin(entities, eq(entities.id, votings.entityId))
    .where(
      and(
        inArray(votings.status, ["active", "closed"]),
        gte(votings.endsAt, sql`${input.date}::date`),
        sql`${ctx.unitPath} LIKE ${entities.path} || '%'`
      )
    );
  if (input.buyers.length + (input.newBuyers?.length ?? 0) > 0) {
    for (const v of missed) warnings.push({ code: "backdated_buyer_missed_voting", params: { voting: v.title } });
  }

  // Assessments for months after the transfer month (issued to the seller).
  const [y, m] = input.date.split("-").map(Number);
  const [assess] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(feeAssessments)
    .innerJoin(accountingPeriods, eq(accountingPeriods.id, feeAssessments.periodId))
    .where(
      and(
        eq(feeAssessments.unitEntityId, input.unitId),
        sql`(${accountingPeriods.year} > ${y} OR (${accountingPeriods.year} = ${y} AND ${feeAssessments.month} > ${m}))`
      )
    );
  if ((assess?.n ?? 0) > 0) {
    warnings.push({ code: "assessments_after_date", params: { count: assess!.n } });
  }

  return finalizePlan({
    action: "transfer",
    archive: [{ group: "ownership_periods", key: "ownershipPeriods", count: ctx.sellerRows.length }],
    move: [],
    keep: [
      { group: "voting", key: "sellerBallots", count: sellerBallots.length },
      { group: "accounting", key: "unitAssessments", count: assess?.n ?? 0 },
    ],
    destroy: [],
    blockers: [],
    warnings,
    summary: {
      unit: ctx.unitLabel,
      sellers: ctx.sellerRows.map((s) => s.name).join(", "),
      buyers: ctx.buyerNames.join(", "),
      date: input.date,
      kind: input.kind,
      newOwners: input.buyers.length + (input.newBuyers?.length ?? 0),
    },
  });
}

export async function planTransfer(input: TransferInput): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const v = await validateTransfer(db, input);
  if (!v.ok) return v;
  return { ok: true, plan: await buildTransferPlan(db, input, v.ctx) };
}

/**
 * One transaction: insert ownership_transfers, end each seller's membership
 * at `date` (end_reason = kind), insert the buyers' memberships from `date`,
 * audit membership.transfer. Any failure rolls everything back.
 */
export async function transferOwnership(
  input: TransferInput,
  actorUserId: string,
  confirmedHash: string
): Promise<LifecycleResult<{ transferId: string }>> {
  // Weights outside the tx (read-only, unit share × owner share).
  const weightOf = async (num: number, den: number) =>
    unitOwnerWeight(input.rootId, input.unitId, num, den);
  const weights = new Map<string, number>();
  for (const b of input.buyers) {
    const w = await weightOf(b.shareNum, b.shareDen);
    if (w === null) return { ok: false, error: "not_found" };
    weights.set(b.userId, w);
  }
  const newWeights: number[] = [];
  for (const b of input.newBuyers ?? []) {
    const w = await weightOf(b.shareNum, b.shareDen);
    if (w === null) return { ok: false, error: "not_found" };
    newWeights.push(w);
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      // Serialise concurrent transfers of the same unit.
      await tx.execute(
        sql`SELECT id FROM ${memberships} WHERE ${memberships.entityId} = ${input.unitId} AND ${memberships.validTo} IS NULL FOR UPDATE`
      );
      const v = await validateTransfer(tx, input);
      if (!v.ok) return v;
      const plan = await buildTransferPlan(tx, input, v.ctx);
      if (plan.hash !== confirmedHash) return { ok: false as const, error: "plan_stale" as const, plan };

      const [transfer] = await tx
        .insert(ownershipTransfers)
        .values({
          unitEntityId: input.unitId,
          effectiveDate: input.date,
          kind: input.kind,
          note: input.note?.trim() || null,
          createdById: actorUserId,
        })
        .returning({ id: ownershipTransfers.id });

      await endMembershipsTx(
        tx,
        v.ctx.sellerRows.map((s) => s.id),
        { date: input.date, reason: input.kind, actorUserId, transferId: transfer.id }
      );
      for (const b of input.buyers) {
        await tx.insert(memberships).values({
          userId: b.userId,
          entityId: input.unitId,
          role: v.ctx.holderRole,
          weight: weights.get(b.userId)!,
          ownerUnitShareNumerator: b.shareNum,
          ownerUnitShareDenominator: b.shareDen,
          status: "active",
          validFrom: input.date,
          transferId: transfer.id,
        });
      }
      // New owner records: same shell shape as createShellOwner / the LV
      // import (no login, pending), invited later through the claim flow.
      const created: { userId: string; share: string }[] = [];
      for (const [i, b] of (input.newBuyers ?? []).entries()) {
        const [u] = await tx
          .insert(users)
          .values({ name: b.name.trim(), role: v.ctx.holderRole, status: "pending", isActive: true })
          .returning({ id: users.id });
        await tx.insert(memberships).values({
          userId: u.id,
          entityId: input.unitId,
          role: v.ctx.holderRole,
          weight: newWeights[i],
          ownerUnitShareNumerator: b.shareNum,
          ownerUnitShareDenominator: b.shareDen,
          status: "active",
          validFrom: input.date,
          transferId: transfer.id,
        });
        created.push({ userId: u.id, share: `${b.shareNum}/${b.shareDen}` });
      }
      await tx.insert(entityAuditLog).values({
        actorUserId,
        action: "membership.transfer",
        entityId: input.unitId,
        beforeJson: JSON.stringify({
          sellers: v.ctx.sellerRows.map((s) => ({ userId: s.userId, membershipId: s.id })),
        }),
        afterJson: JSON.stringify({
          transferId: transfer.id,
          date: input.date,
          kind: input.kind,
          buyers: [
            ...input.buyers.map((b) => ({ userId: b.userId, share: `${b.shareNum}/${b.shareDen}` })),
            ...created,
          ],
        }),
      });
      return { ok: true as const, transferId: transfer.id };
    });
  } catch (err) {
    console.error("[ownership] transfer failed", err);
    return { ok: false, error: "failed" };
  }
}

// ── Remove from community / restore ────────────────────────────────────

async function removeCtx(exec: Exec, userId: string, rootId: string) {
  const inRoot = await exec
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(and(eq(memberships.userId, userId), eq(entities.rootId, rootId), isNull(memberships.validTo)));
  const [elsewhere] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(memberships.userId, userId),
        ne(entities.rootId, rootId),
        isNull(memberships.validTo),
        eq(memberships.status, "active")
      )
    );
  return { membershipIds: inRoot.map((r) => r.id), keepsAccess: (elsewhere?.n ?? 0) > 0 };
}

async function buildRemovePlan(exec: Exec, userId: string, rootId: string, name: string) {
  const c = await removeCtx(exec, userId, rootId);
  const destroy: ImpactLine[] = [];
  const warnings: ImpactPlan["warnings"] = [];
  if (!c.keepsAccess) {
    warnings.push({ code: "account_deactivated" });
    const counts = await countUserFkRows(userId, exec);
    destroy.push(
      { group: "credentials", key: "pushSubscriptions", count: counts.get("push_subscriptions.user_id") ?? 0 },
      { group: "credentials", key: "oauthTokens", count: counts.get("oauth_tokens.user_id") ?? 0 },
      { group: "credentials", key: "mcpPending", count: counts.get("mcp_pending_actions.user_id") ?? 0 }
    );
  }
  const plan = finalizePlan({
    action: "remove",
    archive: [{ group: "ownership_periods", key: "ownershipPeriods", count: c.membershipIds.length }],
    move: [],
    keep: await retainedHistoryLines(userId, exec),
    destroy,
    blockers: [],
    warnings,
    summary: { name, date: todayIso() },
  });
  return { plan, ctx: c };
}

export async function planRemoveFromRoot(
  userId: string,
  rootId: string
): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { ok: false, error: "not_found" };
  const { plan, ctx } = await buildRemovePlan(db, userId, rootId, u.name);
  if (ctx.membershipIds.length === 0) return { ok: false, error: "nothing_to_remove" };
  return { ok: true, plan };
}

/**
 * End every current membership of `userId` under `rootId` (end_reason
 * 'removed'). History is kept. If the user has no active membership under
 * another root the account is deactivated and its credentials (push, OAuth
 * tokens, pending MCP actions) revoked. Audit row id = the restore handle.
 */
export async function removeFromRoot(
  userId: string,
  rootId: string,
  actorUserId: string,
  confirmedHash: string
): Promise<LifecycleResult<{ auditId: string }>> {
  if (userId === actorUserId) return { ok: false, error: "self_action" };
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [u] = await tx
        .select({ name: users.name, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!u) return { ok: false as const, error: "not_found" as const };
      const { plan, ctx } = await buildRemovePlan(tx, userId, rootId, u.name);
      if (ctx.membershipIds.length === 0) return { ok: false as const, error: "nothing_to_remove" as const };
      if (plan.hash !== confirmedHash) return { ok: false as const, error: "plan_stale" as const, plan };

      const today = todayIso();
      const ended = await endMembershipsTx(tx, ctx.membershipIds, { date: today, reason: "removed", actorUserId });
      let deactivated = false;
      if (!ctx.keepsAccess) {
        deactivated = u.isActive;
        await tx.update(users).set({ isActive: false }).where(eq(users.id, userId));
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        await tx.delete(oauthTokens).where(eq(oauthTokens.userId, userId));
        await tx.delete(mcpPendingActions).where(eq(mcpPendingActions.userId, userId));
      }
      const [audit] = await tx
        .insert(entityAuditLog)
        .values({
          actorUserId,
          action: "user.remove_from_root",
          entityId: rootId,
          beforeJson: JSON.stringify({ userId, name: u.name }),
          afterJson: JSON.stringify({ endedMembershipIds: ended, date: today, deactivated }),
        })
        .returning({ id: entityAuditLog.id });
      return { ok: true as const, auditId: audit.id };
    });
  } catch (err) {
    console.error("[ownership] removeFromRoot failed", err);
    return { ok: false, error: "failed" };
  }
}

/** The latest un-restored removal of `userId` from `rootId` (for "Obnoviť"). */
export async function findRestorableRemoval(userId: string, rootId: string): Promise<{ auditId: string; date: string } | null> {
  const rows = await db
    .select({ id: entityAuditLog.id, action: entityAuditLog.action, before: entityAuditLog.beforeJson, after: entityAuditLog.afterJson })
    .from(entityAuditLog)
    .where(
      and(
        eq(entityAuditLog.entityId, rootId),
        inArray(entityAuditLog.action, ["user.remove_from_root", "membership.restore"]),
        sql`${entityAuditLog.beforeJson}::jsonb->>'userId' = ${userId}`
      )
    )
    .orderBy(desc(entityAuditLog.createdAt))
    .limit(1);
  const last = rows[0];
  if (!last || last.action !== "user.remove_from_root") return null;
  const after = JSON.parse(last.after ?? "{}") as { date?: string };
  return { auditId: last.id, date: after.date ?? "" };
}

/**
 * "Obnoviť": re-open EXACTLY the memberships the removal `auditId` ended —
 * all or none. `restore_conflict` when any of them was changed since, or
 * another owner started on one of those units after the removal.
 */
export async function restoreRemoval(
  userId: string,
  rootId: string,
  auditId: string,
  actorUserId: string
): Promise<LifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [audit] = await tx
        .select()
        .from(entityAuditLog)
        .where(and(eq(entityAuditLog.id, auditId), eq(entityAuditLog.action, "user.remove_from_root"), eq(entityAuditLog.entityId, rootId)))
        .limit(1);
      if (!audit) return { ok: false as const, error: "not_found" as const };
      const before = JSON.parse(audit.beforeJson ?? "{}") as { userId?: string };
      const after = JSON.parse(audit.afterJson ?? "{}") as { endedMembershipIds?: string[]; date?: string; deactivated?: boolean };
      if (before.userId !== userId) return { ok: false as const, error: "not_found" as const };
      const latest = await findRestorableRemoval(userId, rootId);
      if (!latest || latest.auditId !== auditId) return { ok: false as const, error: "restore_conflict" as const };
      const ids = after.endedMembershipIds ?? [];
      if (ids.length === 0) return { ok: false as const, error: "restore_conflict" as const };

      const rows = await tx
        .select({ id: memberships.id, entityId: memberships.entityId, validTo: memberships.validTo, endReason: memberships.endReason })
        .from(memberships)
        .where(inArray(memberships.id, ids))
        .for("update");
      if (rows.length !== ids.length || rows.some((r) => r.endReason !== "removed" || r.validTo !== after.date)) {
        return { ok: false as const, error: "restore_conflict" as const };
      }
      const newer = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            inArray(memberships.entityId, rows.map((r) => r.entityId)),
            sql`${memberships.createdAt} > ${audit.createdAt}`
          )
        )
        .limit(1);
      if (newer.length > 0) return { ok: false as const, error: "restore_conflict" as const };

      await tx
        .update(memberships)
        .set({ status: "active", validTo: null, endReason: null, endedById: null })
        .where(inArray(memberships.id, ids));
      if (after.deactivated) await tx.update(users).set({ isActive: true }).where(eq(users.id, userId));
      await tx.insert(entityAuditLog).values({
        actorUserId,
        action: "membership.restore",
        entityId: rootId,
        beforeJson: JSON.stringify({ userId, removalAuditId: auditId }),
        afterJson: JSON.stringify({ restoredMembershipIds: ids }),
      });
      return { ok: true as const };
    });
  } catch (err) {
    // 23505: a current membership on (user, unit) appeared in between.
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) === "23505") return { ok: false, error: "restore_conflict" };
    console.error("[ownership] restoreRemoval failed", err);
    return { ok: false, error: "failed" };
  }
}

// ── Former owners of a community (Vlastníci "Bývalí" chip) ─────────────

/**
 * Users of `rootId` with ended memberships there and NO current one there:
 * userId → the latest valid_to. Read-only, one indexed query.
 */
export async function loadFormerOwners(rootId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ userId: memberships.userId, lastTo: sql<string>`max(${memberships.validTo})::text` })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(entities.rootId, rootId),
        sql`${memberships.validTo} IS NOT NULL`,
        sql`NOT EXISTS (SELECT 1 FROM memberships m2 JOIN entities e2 ON e2.id = m2.entity_id WHERE m2.user_id = ${memberships.userId} AND m2.valid_to IS NULL AND e2.root_id = ${rootId})`
      )
    )
    .groupBy(memberships.userId);
  return new Map(rows.map((r) => [r.userId, r.lastTo]));
}

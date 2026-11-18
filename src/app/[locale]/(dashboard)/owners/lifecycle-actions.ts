"use server";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { memberships } from "@/db/schema";
import { auth } from "@/lib/auth";
import { resolveBoardRootId } from "@/lib/current-entity";
import { hasPermission } from "@/lib/permissions";
import { isUserInRoot } from "@/lib/owners-board.server";
import {
  findRestorableRemoval,
  loadUnitOwnerPeriods,
  planRemoveFromRoot,
  planTransfer,
  removeFromRoot,
  restoreRemoval,
  transferOwnership,
  type TransferInput,
} from "@/lib/ownership.server";
import {
  anonymizeUser,
  hardDeleteUser,
  mergeUsers,
  planAnonymize,
  planHardDelete,
  planMerge,
  suggestSurvivor,
} from "@/lib/user-merge.server";
import type { ImpactPlan, LifecycleResult, TransferKind, UnitOwnerPeriod } from "@/lib/ownership";
import type { UserRole } from "@/types";

// BYT-20261118-007 — owner lifecycle server actions (board only, manageUsers).
// Every destructive action is two calls: planX (read-only, shown in the
// ImpactSummaryDialog) and X(hash) which re-plans inside its transaction and
// refuses with `plan_stale` if anything changed since the preview.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function boardCtx(): Promise<{ actorId: string; rootId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) return null;
  const rootId = await resolveBoardRootId(session.user.id);
  if (!rootId) return null;
  return { actorId: session.user.id, rootId };
}

/** Same visibility as the Vlastníci list: in this root, or with no membership at all. */
async function visibleInRoot(userId: string, rootId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) return false;
  if (await isUserInRoot(userId, rootId)) return true;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  return (row?.n ?? 0) === 0;
}

const forbidden = { ok: false as const, error: "forbidden" as const };
const notFound = { ok: false as const, error: "not_found" as const };

// ── Unit owners (current / with former) ──

export async function loadUnitOwnersAction(
  unitId: string,
  includeFormer: boolean
): Promise<LifecycleResult<{ unitLabel: string; owners: UnitOwnerPeriod[] }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!UUID_RE.test(unitId)) return notFound;
  const r = await loadUnitOwnerPeriods(ctx.rootId, unitId, includeFormer === true);
  return r ? { ok: true, ...r } : notFound;
}

// ── Transfer ──

export interface TransferActionInput {
  unitId: string;
  sellerUserIds: string[];
  buyers: { userId: string; shareNum: number; shareDen: number }[];
  newBuyers?: { name: string; shareNum: number; shareDen: number }[];
  date: string;
  kind: TransferKind;
  note?: string;
}

async function toTransferInput(
  input: TransferActionInput,
  rootId: string
): Promise<TransferInput | null> {
  if (!input || !UUID_RE.test(String(input.unitId))) return null;
  if (!Array.isArray(input.sellerUserIds) || !Array.isArray(input.buyers)) return null;
  for (const id of [...input.sellerUserIds, ...input.buyers.map((b) => b.userId)]) {
    if (!(await visibleInRoot(String(id), rootId))) return null;
  }
  return {
    rootId,
    unitId: String(input.unitId),
    sellerUserIds: input.sellerUserIds.map(String),
    buyers: input.buyers.map((b) => ({
      userId: String(b.userId),
      shareNum: Number(b.shareNum),
      shareDen: Number(b.shareDen),
    })),
    newBuyers: (Array.isArray(input.newBuyers) ? input.newBuyers : []).map((b) => ({
      name: String(b.name ?? ""),
      shareNum: Number(b.shareNum),
      shareDen: Number(b.shareDen),
    })),
    date: String(input.date),
    kind: input.kind,
    note: input.note ? String(input.note).slice(0, 2000) : null,
  };
}

export async function planTransferAction(
  input: TransferActionInput
): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  const t = await toTransferInput(input, ctx.rootId);
  if (!t) return { ok: false, error: "invalid_input" };
  return planTransfer(t);
}

export async function transferAction(
  input: TransferActionInput,
  planHash: string
): Promise<LifecycleResult<{ transferId: string }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!planHash) return { ok: false, error: "not_confirmed" };
  const t = await toTransferInput(input, ctx.rootId);
  if (!t) return { ok: false, error: "invalid_input" };
  return transferOwnership(t, ctx.actorId, String(planHash));
}

// ── Remove from community / restore ──

export async function planRemoveAction(userId: string): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return planRemoveFromRoot(userId, ctx.rootId);
}

export async function removeAction(userId: string, planHash: string): Promise<LifecycleResult<{ auditId: string }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!planHash) return { ok: false, error: "not_confirmed" };
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return removeFromRoot(userId, ctx.rootId, ctx.actorId, String(planHash));
}

export async function findRestorableAction(userId: string): Promise<LifecycleResult<{ auditId: string | null; date: string | null }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!UUID_RE.test(userId)) return notFound;
  const r = await findRestorableRemoval(userId, ctx.rootId);
  return { ok: true, auditId: r?.auditId ?? null, date: r?.date ?? null };
}

export async function restoreAction(userId: string, auditId: string): Promise<LifecycleResult> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!UUID_RE.test(userId) || !UUID_RE.test(auditId)) return notFound;
  return restoreRemoval(userId, ctx.rootId, auditId, ctx.actorId);
}

// ── Merge ──

export async function planMergeAction(
  aId: string,
  bId: string,
  survivorId?: string
): Promise<LifecycleResult<{ plan: ImpactPlan; fromId: string; intoId: string }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!(await visibleInRoot(aId, ctx.rootId)) || !(await visibleInRoot(bId, ctx.rootId))) return notFound;
  const intoId = survivorId === aId || survivorId === bId ? survivorId : await suggestSurvivor(aId, bId);
  const fromId = intoId === aId ? bId : aId;
  const r = await planMerge(fromId, intoId, ctx.actorId);
  return r.ok ? { ok: true, plan: r.plan, fromId, intoId } : r;
}

export async function mergeAction(fromId: string, intoId: string, planHash: string): Promise<LifecycleResult> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!planHash) return { ok: false, error: "not_confirmed" };
  if (!(await visibleInRoot(fromId, ctx.rootId)) || !(await visibleInRoot(intoId, ctx.rootId))) return notFound;
  return mergeUsers(fromId, intoId, ctx.actorId, String(planHash));
}

// ── Anonymise / hard delete ──

export async function planAnonymizeAction(userId: string): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return planAnonymize(userId, ctx.actorId);
}

export async function anonymizeAction(userId: string, planHash: string): Promise<LifecycleResult> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!planHash) return { ok: false, error: "not_confirmed" };
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return anonymizeUser(userId, ctx.actorId, String(planHash));
}

export async function planDeleteAction(userId: string): Promise<LifecycleResult<{ plan: ImpactPlan }>> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return planHardDelete(userId, ctx.actorId);
}

export async function deleteAction(userId: string, planHash: string): Promise<LifecycleResult> {
  const ctx = await boardCtx();
  if (!ctx) return forbidden;
  if (!planHash) return { ok: false, error: "not_confirmed" };
  if (!(await visibleInRoot(userId, ctx.rootId))) return notFound;
  return hardDeleteUser(userId, ctx.actorId, String(planHash));
}

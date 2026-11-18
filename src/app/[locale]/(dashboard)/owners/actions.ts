"use server";

import { auth } from "@/lib/auth";
import { resolveBoardRootId } from "@/lib/current-entity";
import { createShellOwner, revokeShellInvitations } from "@/lib/owners-board.server";
import { dismissOwnerHealthItem, undoOwnerHealthDismissal } from "@/lib/owner-health.server";
import type { DismissErrorCode } from "@/lib/owner-health";
import { hasPermission } from "@/lib/permissions";
import { assertWritable } from "@/lib/readonly";
import type { CreateOwnerErrorCode, RevokeInviteErrorCode } from "@/lib/owners-board";
import type { UserRole } from "@/types";

// Same gate as every /api/users, /api/invitations and /api/admin/shell-users
// handler: an authenticated user whose role has `manageUsers`.
async function requireManageUsers() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) return null;
  return session;
}

export interface CreateOwnerActionInput {
  name: string;
  email: string;
  unitId: string;
  shareNum: number;
  shareDen: number;
  role: UserRole;
}

export async function createOwnerAction(
  input: CreateOwnerActionInput
): Promise<{ ok: true; id: string } | { ok: false; error: CreateOwnerErrorCode }> {
  assertWritable();
  const session = await requireManageUsers();
  if (!session) return { ok: false, error: "forbidden" };
  // Role "admin" stays allowed: parity with the old POST /api/users, which
  // took any role from the body behind the same manageUsers gate.
  const rootId = await resolveBoardRootId(session.user.id);
  return createShellOwner({
    name: String(input.name ?? ""),
    email: input.email ? String(input.email) : null,
    unitId: input.unitId ? String(input.unitId) : null,
    shareNum: Number(input.shareNum),
    shareDen: Number(input.shareDen),
    role: input.role,
    actorUserId: session.user.id,
    rootId,
  });
}

export async function revokeInvitationAction(
  shellUserId: string
): Promise<{ ok: true } | { ok: false; error: RevokeInviteErrorCode }> {
  assertWritable();
  const session = await requireManageUsers();
  if (!session) return { ok: false, error: "forbidden" };
  if (typeof shellUserId !== "string" || !shellUserId) return { ok: false, error: "not_found" };
  try {
    // Only shells of the actor's current community (same scope as the list).
    const rootId = await resolveBoardRootId(session.user.id);
    const n = await revokeShellInvitations(shellUserId, rootId);
    return n > 0 ? { ok: true } : { ok: false, error: "not_found" };
  } catch (err) {
    console.error("[owners] revokeInvitation failed", err);
    return { ok: false, error: "failed" };
  }
}

// ── BYT-20261118-003: "Na riešenie" — mark as handled / undo ──────────
// Shared by the whole board of the community (one row per fingerprint).

export async function dismissOwnerHealthAction(
  fingerprint: string
): Promise<{ ok: true; id: string } | { ok: false; error: DismissErrorCode }> {
  assertWritable();
  const session = await requireManageUsers();
  if (!session) return { ok: false, error: "forbidden" };
  if (typeof fingerprint !== "string" || !fingerprint || fingerprint.length > 128) {
    return { ok: false, error: "not_found" };
  }
  const rootId = await resolveBoardRootId(session.user.id);
  if (!rootId) return { ok: false, error: "not_found" };
  return dismissOwnerHealthItem(rootId, session.user.id, fingerprint);
}

export async function undoOwnerHealthDismissalAction(
  dismissalId: string
): Promise<{ ok: true } | { ok: false; error: DismissErrorCode }> {
  assertWritable();
  const session = await requireManageUsers();
  if (!session) return { ok: false, error: "forbidden" };
  if (typeof dismissalId !== "string" || !/^[0-9a-f-]{36}$/i.test(dismissalId)) {
    return { ok: false, error: "not_found" };
  }
  const rootId = await resolveBoardRootId(session.user.id);
  if (!rootId) return { ok: false, error: "not_found" };
  return undoOwnerHealthDismissal(rootId, dismissalId);
}

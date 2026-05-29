import "server-only";
import crypto from "crypto";
import { and, desc, eq, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, invitations, memberships, users } from "@/db/schema";
import { sendClaimShellInvitation } from "@/lib/email";

const DEFAULT_CLAIM_EXPIRY_DAYS = 14;

export function generateClaimToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function buildClaimUrl(token: string, locale: string): string {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base}/${locale}/claim/${token}`;
}

export interface CreateShellClaimOptions {
  shellUserId: string;
  createdById: string;
  // Locale the claim URL should target. Defaults to project default.
  locale?: string;
  // When provided, the shell user's email is filled in BEFORE inviting
  // (so claiming with that email passes the duplicate check).
  setEmail?: string;
  mode: "email" | "qr";
  expiresInDays?: number;
}

export interface CreateShellClaimResult {
  token: string;
  claimUrl: string;
  expiresAt: Date;
  emailSent: boolean;
}

/**
 * Issue a per-shell-user invitation. Optionally writes an email onto the
 * shell row before sending. Used by the Owners → pending shell users UI
 * (BYT-20260512-001).
 */
export async function createShellClaim(
  opts: CreateShellClaimOptions
): Promise<CreateShellClaimResult> {
  const [shell] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, opts.shellUserId));

  if (!shell) throw new Error("Shell user not found");
  if (shell.passwordHash !== null) {
    throw new Error("User already has an account — claim not applicable");
  }

  const targetEmail = opts.setEmail?.trim() || shell.email;

  if (opts.mode === "email" && !targetEmail) {
    throw new Error("Email required to send an email invitation");
  }

  if (opts.setEmail) {
    const trimmed = opts.setEmail.trim().toLowerCase();
    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, trimmed), ne(users.id, shell.id)));
    if (conflict) {
      throw new Error("Email already in use by another account");
    }
    await db.update(users).set({ email: trimmed }).where(eq(users.id, shell.id));
  }

  const token = generateClaimToken();
  const expiresAt = new Date();
  expiresAt.setDate(
    expiresAt.getDate() + (opts.expiresInDays ?? DEFAULT_CLAIM_EXPIRY_DAYS)
  );

  await db.insert(invitations).values({
    token,
    role: "owner",
    expiresAt,
    createdById: opts.createdById,
    targetShellUserId: shell.id,
  });

  const locale = opts.locale ?? "sk";
  const claimUrl = buildClaimUrl(token, locale);

  let emailSent = false;
  if (opts.mode === "email" && targetEmail) {
    emailSent = await sendClaimShellInvitation({
      recipientEmail: targetEmail,
      recipientName: shell.name,
      claimUrl,
      expiryDays: opts.expiresInDays ?? DEFAULT_CLAIM_EXPIRY_DAYS,
      locale,
    });
  }

  return { token, claimUrl, expiresAt, emailSent };
}

export interface PendingShellUserRow {
  id: string;
  name: string;
  email: string | null;
  flatNumber: string | null;
  shareNumerator: number;
  shareDenominator: number;
  membershipId: string;
  entityId: string;
  hasOpenInvite: boolean;
}

/**
 * Shell users (status='pending', passwordHash IS NULL) with at least one
 * active membership inside the given housing root. Used by the Owners →
 * pending shell users admin page.
 */
export async function listPendingShellUsers(
  rootId: string
): Promise<PendingShellUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      shareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
      membershipId: memberships.id,
      entityId: entities.id,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(users.status, "pending"),
        isNull(users.passwordHash),
        eq(memberships.status, "active"),
        // Only shells actually assigned to a flat (unit). A shell whose
        // active membership sits on a non-unit entity (root/entrance) has
        // no flat and must not appear in the pending owners list.
        eq(entities.kind, "unit"),
        eq(entities.rootId, rootId)
      )
    )
    .orderBy(desc(users.createdAt));

  if (rows.length === 0) return [];

  const openInvites = await db
    .select({ shellId: invitations.targetShellUserId })
    .from(invitations)
    .where(
      and(
        eq(invitations.status, "pending"),
        isNotNull(invitations.targetShellUserId)
      )
    );
  const openSet = new Set(
    openInvites.map((r) => r.shellId).filter((id): id is string => !!id)
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    flatNumber: r.flatNumber,
    shareNumerator: r.shareNumerator ?? 1,
    shareDenominator: r.shareDenominator ?? 1,
    membershipId: r.membershipId,
    entityId: r.entityId,
    hasOpenInvite: openSet.has(r.id),
  }));
}

export interface ClaimableRealUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
}

/**
 * Real users (status='pending', has email + passwordHash) who hold NO
 * active memberships anywhere. These are bulk-QR self-registrants awaiting
 * an admin to merge them into an existing shell user — the "target" side
 * of `mergeShellIntoUser`.
 *
 * The status='pending' filter is essential: an already-accepted user
 * (status='active') who was later removed from all flats also has no
 * active membership, but is NOT an unhandled registration request and
 * must not reappear here.
 *
 * `rootId` is currently unused because bulk-QR registrants have no
 * community association until merged; admin matches them by name.
 */
export async function listClaimableRealUsers(): Promise<ClaimableRealUser[]> {
  const withMembership = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.status, "active"));

  return db
    .select({
      id: users.id,
      name: users.name,
      email: sql<string>`coalesce(${users.email}, '')`.as("email"),
      phone: users.phone,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        eq(users.status, "pending"),
        isNotNull(users.email),
        isNotNull(users.passwordHash),
        notInArray(users.id, withMembership)
      )
    )
    .orderBy(desc(users.createdAt));
}

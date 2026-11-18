import "server-only";
import crypto from "crypto";
import { and, desc, eq, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, invitations, memberships, users } from "@/db/schema";
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, normalizeShortCode } from "@/lib/invitations-codes";
import { isSmtpConfigured, sendClaimShellInvitation, type EmailSendStatus } from "@/lib/email";

const DEFAULT_CLAIM_EXPIRY_DAYS = 14;
// Paper letters sit in a mailbox for weeks; e-mail / on-screen links stay at 14.
export const PAPER_CLAIM_EXPIRY_DAYS = 60;

export function generateShortCode(): string {
  const bytes = crypto.randomBytes(SHORT_CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  return out;
}

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
  /** Paper letter: also issue a short typeable code (printed next to the QR). */
  withShortCode?: boolean;
}

export interface CreateShellClaimResult {
  token: string;
  claimUrl: string;
  expiresAt: Date;
  emailSent: boolean;
  /** "not_configured" = no SMTP on this instance, nothing was sent. */
  emailStatus: EmailSendStatus | "not_requested";
  shortCode: string | null;
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

  let shortCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = opts.withShortCode ? generateShortCode() : null;
    try {
      await db.insert(invitations).values({
        token,
        role: "owner",
        expiresAt,
        createdById: opts.createdById,
        targetShellUserId: shell.id,
        shortCode: candidate,
      });
      shortCode = candidate;
      break;
    } catch (err) {
      // Unique clash on the short code only — retry with a fresh code.
      if (!candidate || attempt === 4) throw err;
    }
  }

  const locale = opts.locale ?? "sk";
  const claimUrl = buildClaimUrl(token, locale);

  let emailSent = false;
  let emailStatus: CreateShellClaimResult["emailStatus"] = "not_requested";
  if (opts.mode === "email" && targetEmail) {
    emailStatus = isSmtpConfigured() ? "failed" : "not_configured";
    emailSent = await sendClaimShellInvitation({
      recipientEmail: targetEmail,
      recipientName: shell.name,
      claimUrl,
      expiryDays: opts.expiresInDays ?? DEFAULT_CLAIM_EXPIRY_DAYS,
      locale,
    });
    if (emailSent) emailStatus = "sent";
  }

  return { token, claimUrl, expiresAt, emailSent, emailStatus, shortCode };
}

export interface PaperLetter {
  shellId: string;
  name: string;
  flats: string[];
  claimUrl: string;
  shortCode: string;
  expiresAt: Date;
}

/**
 * One claim (60 days, with short code) per selected pending shell owner of the
 * community — input to the bulk "Listy pre vlastníkov bez účtu" PDF. Shells
 * without an active unit membership in `rootId` are skipped silently.
 * `onlyWithoutEmail` narrows to owners who cannot get an e-mail link.
 */
export async function createPaperLetters(opts: {
  rootId: string;
  createdById: string;
  locale?: string;
  shellIds?: string[];
  onlyWithoutEmail?: boolean;
}): Promise<PaperLetter[]> {
  const pending = await listPendingShellUsers(opts.rootId);
  const wanted = pending.filter(
    (p) =>
      (!opts.shellIds || opts.shellIds.includes(p.id)) &&
      (!opts.onlyWithoutEmail || !p.email)
  );
  const byUser = new Map<string, { name: string; flats: string[] }>();
  for (const p of wanted) {
    const cur = byUser.get(p.id) ?? { name: p.name, flats: [] };
    if (p.flatNumber) cur.flats.push(p.flatNumber);
    byUser.set(p.id, cur);
  }
  const out: PaperLetter[] = [];
  for (const [shellId, info] of byUser) {
    const claim = await createShellClaim({
      shellUserId: shellId,
      createdById: opts.createdById,
      locale: opts.locale,
      mode: "qr",
      expiresInDays: PAPER_CLAIM_EXPIRY_DAYS,
      withShortCode: true,
    });
    if (!claim.shortCode) continue;
    out.push({
      shellId,
      name: info.name,
      flats: info.flats,
      claimUrl: claim.claimUrl,
      shortCode: claim.shortCode,
      expiresAt: claim.expiresAt,
    });
  }
  return out;
}

/** Board marks an owner as paper-only (or clears it). Returns false if no such user. */
export async function setPaperOnly(userId: string, paperOnly: boolean): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ paperOnly })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Resolve a typed short code to its token (pending, unexpired) — null otherwise. */
export async function resolveShortCode(raw: string): Promise<string | null> {
  const code = normalizeShortCode(raw);
  if (code.length !== SHORT_CODE_LENGTH) return null;
  const [row] = await db
    .select({ token: invitations.token, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.shortCode, code), eq(invitations.status, "pending")))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.token;
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
  paperOnly: boolean;
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
      paperOnly: users.paperOnly,
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
    paperOnly: r.paperOnly,
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

import "server-only";
// BYT-20261117-002 Phase 6: confirmation gate for electronic ballots.
//
//   POST /api/ballots/passkey-options    → assertion options; challenge = signed token bound to the ballot
//                                          ({ action: "withdraw" } → bound to withdrawing the current ballot)
//   POST /api/ballots/email-confirmation → e-mails a single-use link (token carries the choices)
//                                          ({ action: "withdraw" } → link that withdraws the current ballot)
//   POST /api/ballots { confirmation }   → verifies the proof and records the ballot (castConfirmed)
//   DELETE /api/ballots { confirmation } → verifies the proof and withdraws the ballot (withdrawConfirmed)
//
// Every error is a stable code (CastErrorCode) mapped to VoteCast.errors.* in the UI.
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  ConfirmationUnavailableError,
  signToken,
  verifyToken,
  type SignedTokenPurpose,
} from "@/lib/signed-token.server";
import {
  activatePendingPasskey,
  assertionChallengeToken,
  createAssertionOptions,
  getPendingPasskey,
  getPublicAppUrl,
  userPasskeyState,
  verifyAssertion,
} from "@/lib/webauthn.server";
import { maskEmail, sendPasskeyAddedNotice } from "@/lib/webauthn-email.server";
import {
  EMAIL_CONFIRMATION_TTL_MS,
  PASSKEY_CHALLENGE_TTL_MS,
} from "@/lib/webauthn";
import { routing } from "@/i18n/routing";
import { getTransporter } from "@/lib/email";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  sendVoteConfirmation,
  sendVoteConfirmationLink,
  sendWithdrawConfirmationLink,
} from "@modules/voting/src/email/vote-confirmation";
import type { Country, UserRole, VoteChoice } from "@/types";
import {
  VALID_CHOICES,
  ballotTokensRevokedAt,
  claimsMatch,
  currentBallot,
  currentBallotState,
  describeBallot,
  recordConfirmedBallot,
  validateCast,
  withdrawConfirmedBallot,
  withdrawDigest,
  type CastErrorCode,
  type ConfirmationMethod,
  type MarkedChoice,
  type VoteConfirmClaims,
} from "./cast.server";

const OPTIONS_LIMIT = { maxRequests: 20, windowMs: 10 * 60 * 1000 };
const EMAIL_LIMIT = { maxRequests: 5, windowMs: 15 * 60 * 1000 };
const CONFIRM_LIMIT = { maxRequests: 30, windowMs: 10 * 60 * 1000 };

function err(code: CastErrorCode, status: number) {
  return NextResponse.json({ error: code }, { status });
}

function rateLimited(request: NextRequest, limit: typeof OPTIONS_LIMIT, tier: string) {
  return checkRateLimit(request, limit, tier) ? err("RATE_LIMITED", 429) : null;
}

function pickLocale(input: unknown): string {
  return typeof input === "string" &&
    (routing.locales as readonly string[]).includes(input)
    ? input
    : routing.defaultLocale;
}

async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Session + "vote" permission, shared by the option and e-mail routes. */
async function requireVoter(): Promise<
  { ok: false; res: NextResponse } | { ok: true; userId: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, res: err("UNAUTHORIZED", 401) };
  if (!hasPermission(session.user.role as UserRole, "vote")) {
    return { ok: false, res: err("FORBIDDEN", 403) };
  }
  return { ok: true, userId: session.user.id };
}

/** The token's voter must still be an active account with the "vote" permission. */
async function voterStillAllowed(userId: string): Promise<boolean> {
  const [voter] = await db
    .select({ role: users.role, isActive: users.isActive, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(
    voter &&
      voter.isActive &&
      voter.status === "active" &&
      hasPermission(voter.role as UserRole, "vote")
  );
}

async function communityCountry(): Promise<Country> {
  const root = await getCommunityRoot();
  return (root?.country ?? "sk") as Country;
}

// ── Withdraw pre-checks (before a token is issued) ──────
type WithdrawCheck =
  | { ok: true; ballotHash: string; pb: number }
  | { ok: false; code: CastErrorCode; status: number };

/**
 * An owner may withdraw only their own electronic ballot for a unit they
 * still own, while the voting is active and before its deadline. The same
 * conditions are re-checked under lock in withdrawConfirmedBallot.
 */
async function checkWithdraw(
  votingId: string,
  flatId: string,
  voterId: string
): Promise<WithdrawCheck> {
  const [voting] = await db
    .select({ status: votings.status, endsAt: votings.endsAt })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting || voting.status !== "active") {
    return { ok: false, code: "VOTING_NOT_ACTIVE", status: 400 };
  }
  if (Date.now() > voting.endsAt.getTime()) {
    return { ok: false, code: "VOTING_ENDED", status: 400 };
  }
  const [owner] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, voterId),
        eq(memberships.entityId, flatId),
        eq(memberships.status, "active")
      )
    )
    .limit(1);
  if (!owner) return { ok: false, code: "NOT_UNIT_OWNER", status: 400 };
  const ballot = await currentBallot(votingId, flatId, voterId);
  if (!ballot) return { ok: false, code: "BALLOT_NOT_FOUND", status: 404 };
  if (ballot.voteType === "paper") return { ok: false, code: "PAPER_BALLOT_LOCKED", status: 409 };
  return {
    ok: true,
    ballotHash: withdrawDigest(votingId, flatId, ballot.ballotHash),
    pb: ballot.recordedAtMs,
  };
}

/** A paper ballot cannot be replaced by the owner — say so before any confirmation step. */
async function paperLocked(votingId: string, flatId: string, voterId: string): Promise<boolean> {
  const b = await currentBallot(votingId, flatId, voterId);
  return b?.voteType === "paper";
}

// ── Passkey: assertion options bound to the ballot ──────
export async function passkeyOptions(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimited(request, OPTIONS_LIMIT, "vote-passkey-options");
  if (limited) return limited;
  const who = await requireVoter();
  if (!who.ok) return who.res;
  const userId = who.userId;

  const body = await readJson(request);
  const votingId = typeof body?.votingId === "string" ? body.votingId : "";
  const flatId = typeof body?.flatId === "string" ? body.flatId : "";
  if (!votingId || !flatId) return err("INVALID_REQUEST", 400);
  const withdraw = body?.action === "withdraw";

  let purpose: SignedTokenPurpose;
  let digest: string;
  let pb: number;
  if (withdraw) {
    const w = await checkWithdraw(votingId, flatId, userId);
    if (!w.ok) return err(w.code, w.status);
    purpose = "vote-withdraw-passkey";
    digest = w.ballotHash;
    pb = w.pb;
  } else {
    const v = await validateCast({
      votingId,
      flatId,
      voterId: userId,
      incoming: body?.items,
      electronic: true,
    });
    if (!v.ok) return err(v.code, v.status);
    if (await paperLocked(votingId, flatId, userId)) return err("PAPER_BALLOT_LOCKED", 409);
    purpose = "vote-passkey";
    digest = v.ballotHash;
    pb = await currentBallotState(votingId, flatId, userId);
  }

  const pk = await userPasskeyState(userId);
  if (!pk.active) return err(pk.pending ? "PASSKEY_PENDING" : "NO_PASSKEY", 409);

  try {
    const { token } = signToken<VoteConfirmClaims>(
      purpose,
      { u: userId, v: votingId, e: flatId, d: digest, pb },
      PASSKEY_CHALLENGE_TTL_MS
    );
    const options = await createAssertionOptions(request, userId, token);
    return NextResponse.json({ options, ballotHash: digest });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) return err("CONFIRMATION_UNAVAILABLE", 503);
    throw e;
  }
}

// ── E-mail: send the single-use confirmation link ───────
export async function emailConfirmation(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimited(request, EMAIL_LIMIT, "vote-email-confirmation");
  if (limited) return limited;
  const who = await requireVoter();
  if (!who.ok) return who.res;
  const userId = who.userId;

  const body = await readJson(request);
  const votingId = typeof body?.votingId === "string" ? body.votingId : "";
  const flatId = typeof body?.flatId === "string" ? body.flatId : "";
  if (!votingId || !flatId) return err("INVALID_REQUEST", 400);
  const locale = pickLocale(body?.locale);
  const withdraw = body?.action === "withdraw";

  let claims: VoteConfirmClaims;
  let marked: MarkedChoice[] = [];
  if (withdraw) {
    const w = await checkWithdraw(votingId, flatId, userId);
    if (!w.ok) return err(w.code, w.status);
    claims = { u: userId, v: votingId, e: flatId, d: w.ballotHash, pb: w.pb, l: locale };
  } else {
    const v = await validateCast({
      votingId,
      flatId,
      voterId: userId,
      incoming: body?.items,
      electronic: true,
    });
    if (!v.ok) return err(v.code, v.status);
    if (await paperLocked(votingId, flatId, userId)) return err("PAPER_BALLOT_LOCKED", 409);
    marked = v.marked;
    claims = {
      u: userId,
      v: votingId,
      e: flatId,
      d: v.ballotHash,
      pb: await currentBallotState(votingId, flatId, userId),
      c: v.marked.map((m) => [m.itemId, m.choice]),
      l: locale,
    };
    // Inline first-vote flow: this link also activates the passkey the voter
    // has just registered (bound to its row id AND credential id).
    if (typeof body?.activatePasskeyId === "string") {
      const pending = await getPendingPasskey(userId, body.activatePasskeyId);
      if (!pending) return err("PASSKEY_NOT_FOUND", 404);
      claims.k = pending.id;
      claims.kc = pending.credentialId;
    }
  }

  const [voter] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!voter?.email) return err("NO_EMAIL", 409);
  if (!getTransporter()) return err("EMAIL_UNAVAILABLE", 503);

  let token: string;
  let exp: number;
  let appUrl: string;
  try {
    const signed = signToken<VoteConfirmClaims>(
      withdraw ? "vote-withdraw-email" : "vote-email",
      claims,
      EMAIL_CONFIRMATION_TTL_MS
    );
    token = signed.token;
    exp = signed.claims.exp;
    appUrl = getPublicAppUrl(request);
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) return err("CONFIRMATION_UNAVAILABLE", 503);
    throw e;
  }

  const country = await communityCountry();
  const confirmUrl = `${appUrl}/${locale}/vote-confirm?t=${encodeURIComponent(token)}`;
  let sent: boolean;
  if (withdraw) {
    const described = await describeBallot(votingId, flatId, []);
    sent = await sendWithdrawConfirmationLink({
      recipientEmail: voter.email,
      voterName: voter.name,
      votingTitle: described.votingTitle,
      flatNumber: described.flatNumber,
      confirmUrl,
      expiresAt: new Date(exp),
      country,
      locale,
    });
  } else {
    const described = await describeBallot(votingId, flatId, marked);
    sent = await sendVoteConfirmationLink({
      recipientEmail: voter.email,
      voterName: voter.name,
      votingTitle: described.votingTitle,
      flatNumber: described.flatNumber,
      items: described.items,
      confirmUrl,
      expiresAt: new Date(exp),
      activatesPasskey: Boolean(claims.k),
      country,
      locale,
    });
  }
  if (!sent) return err("EMAIL_UNAVAILABLE", 503);
  return NextResponse.json({ sentTo: maskEmail(voter.email), expiresAt: new Date(exp).toISOString() });
}

// ── Recording: POST /api/ballots with a confirmation proof ──
function tokenErrorCode(e: string): CastErrorCode {
  return e === "TOKEN_EXPIRED" ? "CONFIRMATION_EXPIRED" : "CONFIRMATION_INVALID";
}

async function finish(
  input: {
    votingId: string;
    flatId: string;
    voterId: string;
    marked: MarkedChoice[];
    ballotHash: string;
    claims: VoteConfirmClaims & { iat: number };
    method: ConfirmationMethod;
    signature: string | null;
    locale: string;
    country: Country;
    passkeyActivated?: boolean;
  }
) {
  const rec = await recordConfirmedBallot(input);
  if (!rec.ok) return err(rec.code, rec.status);

  // Receipt e-mail (best effort, never blocks or fails the recorded vote).
  void (async () => {
    const [voter] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, input.voterId))
      .limit(1);
    if (!voter?.email) return;
    const d = await describeBallot(input.votingId, input.flatId, input.marked);
    await sendVoteConfirmation({
      recipientEmail: voter.email,
      voterName: voter.name,
      votingTitle: d.votingTitle,
      flatNumber: d.flatNumber,
      items: d.items,
      timestamp: rec.recordedAt,
      ballotHash: input.ballotHash,
      method: input.method,
      country: input.country,
      locale: input.locale,
    });
  })().catch((e) => console.error("[voting] receipt e-mail failed:", e));

  return NextResponse.json(
    {
      ballotId: rec.ballotId,
      ballotHash: input.ballotHash,
      recordedAt: rec.recordedAt,
      confirmationMethod: input.method,
      superseded: rec.superseded,
      passkeyActivated: Boolean(input.passkeyActivated),
    },
    { status: rec.superseded ? 200 : 201 }
  );
}

/**
 * Electronic cast. Requires `confirmation`:
 *   { method: "passkey", response: AuthenticationResponseJSON } + session + the ballot in the body
 *   { method: "email", token }  — the ballot comes from the signed token; no session needed
 *     (the link may be opened on another device), the voter is the token's user.
 */
export async function castConfirmed(
  request: NextRequest,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const limited = rateLimited(request, CONFIRM_LIMIT, "vote-confirm");
  if (limited) return limited;

  const confirmation = (body.confirmation ?? null) as
    | { method?: unknown; response?: unknown; token?: unknown }
    | null;
  if (!confirmation || (confirmation.method !== "passkey" && confirmation.method !== "email")) {
    return err("CONFIRMATION_REQUIRED", 403);
  }
  const locale = pickLocale(body.locale);

  try {
    if (confirmation.method === "email") {
      const vt = verifyToken<VoteConfirmClaims>("vote-email", confirmation.token);
      if (!vt.ok) return err(tokenErrorCode(vt.error), 400);
      const claims = vt.claims;
      if (!Array.isArray(claims.c)) return err("CONFIRMATION_INVALID", 400);
      if (!(await voterStillAllowed(claims.u))) return err("FORBIDDEN", 403);

      // Inline first-vote flow: clicking this link proves control of the
      // mailbox exactly like a separate activation link would, so it also
      // activates the passkey registered with it — whatever happens to the
      // ballot below (a stale or late ballot does not make the proof weaker).
      // Idempotent: only a still-pending credential of this user flips.
      let passkeyActivated = false;
      if (claims.k && claims.kc) {
        const a = await activatePendingPasskey(claims.u, claims.k, claims.kc);
        if (a.ok) {
          passkeyActivated = true;
          void sendPasskeyAddedNotice({
            userId: claims.u,
            deviceLabel: a.deviceLabel,
            activatedAt: a.activatedAt,
            locale: claims.l ? pickLocale(claims.l) : locale,
          });
        }
      }

      const incoming = claims.c.map(([itemId, choice]) => ({ itemId, choice }));
      const v = await validateCast({
        votingId: claims.v,
        flatId: claims.e,
        voterId: claims.u,
        incoming,
        electronic: true,
      });
      if (!v.ok) return err(v.code, v.status);
      if (!claimsMatch(claims, { voterId: claims.u, votingId: claims.v, flatId: claims.e, ballotHash: v.ballotHash })) {
        return err("CONFIRMATION_MISMATCH", 400);
      }
      return finish({
        votingId: claims.v,
        flatId: claims.e,
        voterId: claims.u,
        marked: v.marked,
        ballotHash: v.ballotHash,
        claims,
        method: "email",
        signature: null,
        locale: claims.l ? pickLocale(claims.l) : locale,
        country: v.country,
        passkeyActivated,
      });
    }

    // Passkey.
    const session = await auth();
    if (!session?.user?.id) return err("UNAUTHORIZED", 401);
    if (!hasPermission(session.user.role as UserRole, "vote")) return err("FORBIDDEN", 403);
    const userId = session.user.id;

    const votingId = typeof body.votingId === "string" ? body.votingId : "";
    const flatId = typeof body.flatId === "string" ? body.flatId : "";
    if (!votingId || !flatId) return err("INVALID_REQUEST", 400);

    const response = confirmation.response as Parameters<typeof verifyAssertion>[2];
    const recovered = response ? assertionChallengeToken(response) : null;
    if (!recovered) return err("CONFIRMATION_INVALID", 400);
    const vt = verifyToken<VoteConfirmClaims>("vote-passkey", recovered.token);
    if (!vt.ok) return err(tokenErrorCode(vt.error), 400);

    const v = await validateCast({
      votingId,
      flatId,
      voterId: userId,
      incoming: body.items,
      electronic: true,
    });
    if (!v.ok) return err(v.code, v.status);
    // The signed challenge must be bound to exactly this voter, voting, unit
    // and ballot content.
    if (!claimsMatch(vt.claims, { voterId: userId, votingId, flatId, ballotHash: v.ballotHash })) {
      return err("CONFIRMATION_MISMATCH", 400);
    }

    const a = await verifyAssertion(request, userId, response, recovered.challenge);
    if (!a.ok) return err(a.code, 400);

    return finish({
      votingId,
      flatId,
      voterId: userId,
      marked: v.marked,
      ballotHash: v.ballotHash,
      claims: vt.claims,
      method: "passkey",
      signature: a.proof,
      locale,
      country: v.country,
    });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) return err("CONFIRMATION_UNAVAILABLE", 503);
    throw e;
  }
}

/**
 * Owner withdrawal (DELETE /api/ballots without ownerId). Requires
 * `confirmation` in the JSON body, bound to withdrawing exactly the current
 * ballot:
 *   { method: "passkey", response } + session + ?votingId&flatId
 *   { method: "email", token } — voter, voting and unit come from the token;
 *     no session needed (the link may be opened on another device).
 */
export async function withdrawConfirmed(
  request: NextRequest,
  body: Record<string, unknown> | null,
  query: { votingId: string | null; flatId: string | null }
): Promise<NextResponse> {
  const limited = rateLimited(request, CONFIRM_LIMIT, "vote-withdraw");
  if (limited) return limited;

  const confirmation = (body?.confirmation ?? null) as
    | { method?: unknown; response?: unknown; token?: unknown }
    | null;
  if (!confirmation || (confirmation.method !== "passkey" && confirmation.method !== "email")) {
    return err("CONFIRMATION_REQUIRED", 403);
  }

  try {
    if (confirmation.method === "email") {
      const vt = verifyToken<VoteConfirmClaims>("vote-withdraw-email", confirmation.token);
      if (!vt.ok) return err(tokenErrorCode(vt.error), 400);
      if (!(await voterStillAllowed(vt.claims.u))) return err("FORBIDDEN", 403);
      const w = await checkWithdraw(vt.claims.v, vt.claims.e, vt.claims.u);
      if (!w.ok) return err(w.code, w.status);
      const r = await withdrawConfirmedBallot({
        votingId: vt.claims.v,
        flatId: vt.claims.e,
        voterId: vt.claims.u,
        claims: vt.claims,
      });
      if (!r.ok) return err(r.code, r.status);
      return NextResponse.json({ ok: true, withdrawnAt: r.withdrawnAt, votingId: vt.claims.v });
    }

    const session = await auth();
    if (!session?.user?.id) return err("UNAUTHORIZED", 401);
    if (!hasPermission(session.user.role as UserRole, "vote")) return err("FORBIDDEN", 403);
    const userId = session.user.id;
    const { votingId, flatId } = query;
    if (!votingId || !flatId) return err("INVALID_REQUEST", 400);

    const response = confirmation.response as Parameters<typeof verifyAssertion>[2];
    const recovered = response ? assertionChallengeToken(response) : null;
    if (!recovered) return err("CONFIRMATION_INVALID", 400);
    const vt = verifyToken<VoteConfirmClaims>("vote-withdraw-passkey", recovered.token);
    if (!vt.ok) return err(tokenErrorCode(vt.error), 400);
    if (vt.claims.u !== userId || vt.claims.v !== votingId || vt.claims.e !== flatId) {
      return err("CONFIRMATION_MISMATCH", 400);
    }
    const w = await checkWithdraw(votingId, flatId, userId);
    if (!w.ok) return err(w.code, w.status);

    const a = await verifyAssertion(request, userId, response, recovered.challenge);
    if (!a.ok) return err(a.code, 400);

    const r = await withdrawConfirmedBallot({ votingId, flatId, voterId: userId, claims: vt.claims });
    if (!r.ok) return err(r.code, r.status);
    return NextResponse.json({ ok: true, withdrawnAt: r.withdrawnAt, votingId });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) return err("CONFIRMATION_UNAVAILABLE", 503);
    throw e;
  }
}

// ── E-mail link page (GET): describe, never record ──────
export type EmailConfirmationView =
  | { status: "invalid" | "expired" | "superseded" | "closed" | "paperLocked" }
  | {
      status: "ready";
      action: "vote";
      votingId: string;
      votingTitle: string;
      flatNumber: string;
      voterName: string;
      endsAt: string;
      items: { idx: number; title: string; choice: VoteChoice }[];
      activatesPasskey: boolean;
    }
  | {
      status: "ready";
      action: "withdraw";
      votingId: string;
      votingTitle: string;
      flatNumber: string;
      voterName: string;
      endsAt: string;
    };

async function voterName(userId: string): Promise<string> {
  const [voter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return voter?.name ?? "";
}

/**
 * Read-only description of an e-mail confirmation token for the link page.
 * Opening the link (GET, e.g. a mail scanner prefetch) never records or
 * withdraws anything; only the explicit POST / DELETE from the page does.
 */
export async function describeEmailConfirmation(token: unknown): Promise<EmailConfirmationView> {
  let vt;
  let wt;
  try {
    vt = verifyToken<VoteConfirmClaims>("vote-email", token);
    wt = vt.ok ? null : verifyToken<VoteConfirmClaims>("vote-withdraw-email", token);
  } catch {
    return { status: "invalid" };
  }

  // Withdraw link.
  if (wt) {
    if (!wt.ok) {
      // Report expiry of whichever purpose the token really has.
      if ((!vt.ok && vt.error === "TOKEN_EXPIRED") || wt.error === "TOKEN_EXPIRED") {
        return { status: "expired" };
      }
      return { status: "invalid" };
    }
    const c = wt.claims;
    const w = await checkWithdraw(c.v, c.e, c.u);
    if (!w.ok) {
      if (w.code === "VOTING_NOT_ACTIVE" || w.code === "VOTING_ENDED") return { status: "closed" };
      if (w.code === "PAPER_BALLOT_LOCKED") return { status: "paperLocked" };
      if (w.code === "BALLOT_NOT_FOUND") return { status: "superseded" };
      return { status: "invalid" };
    }
    if (w.pb !== c.pb || w.ballotHash !== c.d) return { status: "superseded" };
    const d = await describeBallot(c.v, c.e, []);
    return {
      status: "ready",
      action: "withdraw",
      votingId: c.v,
      votingTitle: d.votingTitle,
      flatNumber: d.flatNumber,
      voterName: await voterName(c.u),
      endsAt: d.endsAt.toISOString(),
    };
  }

  if (!vt.ok) return { status: vt.error === "TOKEN_EXPIRED" ? "expired" : "invalid" };
  const c = vt.claims;
  if (!Array.isArray(c.c)) return { status: "invalid" };

  const marked: MarkedChoice[] = c.c
    .filter(([, choice]) => VALID_CHOICES.includes(choice))
    .map(([itemId, choice]) => ({ itemId, choice }));
  const v = await validateCast({
    votingId: c.v,
    flatId: c.e,
    voterId: c.u,
    incoming: marked,
    electronic: true,
  });
  if (!v.ok) {
    return { status: v.code === "VOTING_NOT_ACTIVE" || v.code === "VOTING_ENDED" ? "closed" : "invalid" };
  }
  if (v.ballotHash !== c.d) return { status: "invalid" };
  const current = await currentBallot(c.v, c.e, c.u);
  if (current?.voteType === "paper") return { status: "paperLocked" };
  const state = current ? current.recordedAtMs : 0;
  if (state !== c.pb || (state !== 0 && c.iat <= state)) return { status: "superseded" };
  if (c.iat <= (await ballotTokensRevokedAt(c.v, c.e, c.u))) return { status: "superseded" };

  const d = await describeBallot(c.v, c.e, marked);
  return {
    status: "ready",
    action: "vote",
    votingId: c.v,
    votingTitle: d.votingTitle,
    flatNumber: d.flatNumber,
    voterName: await voterName(c.u),
    endsAt: d.endsAt.toISOString(),
    items: d.items,
    activatesPasskey: Boolean(c.k && c.kc),
  };
}

import "server-only";
import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { invitations, ssoConsumedTokens, users } from "@/db/schema";
import { recordEntityAudit } from "@/lib/entity-audit";
import { isReadonly } from "@/lib/readonly";
import { signToken, verifyToken } from "@/lib/signed-token.server";
import type { UserRole, UserStatus } from "@/types";

// Claim a prepared (shell) owner account by a link e-mailed to the address
// the owner typed on the claim page — no password needed.
//
//   POST /api/claim/[token] { mode: "link", email } → mintClaimLinkToken →
//   e-mail with /{locale}/claim/{token}/link?t=… → the owner presses the
//   button there → signIn("claim-link", { token }) → consumeClaimLinkToken
//   (auth.ts Credentials provider) activates the shell with that e-mail and
//   signs in.
//
// Security:
//   - The token is HMAC-signed (signed-token.server.ts, timing-safe compare)
//     and binds invitation id + shell user id + e-mail + expiry (30 min).
//     The e-mail is never taken from the click — only from the signed token,
//     so opening the mailbox is the proof of ownership of that address.
//   - Single use: the token nonce is recorded in sso_consumed_tokens (PK
//     insert, shared by all replicas) in the same transaction that activates
//     the account; a second click / a parallel click conflicts and fails.
//   - The invitation must still be pending, unexpired and target the same
//     shell when the link is used; activation burns it (+ every other open
//     invitation for that shell), exactly like the password claim.
//   - The landing page never consumes on GET (mail scanners prefetch links):
//     the owner has to press a button that POSTs the sign-in.

export const CLAIM_LINK_TTL_MS = 30 * 60 * 1000;

interface ClaimLinkClaims {
  /** invitation id */
  inv: string;
  /** shell user id the invitation targets */
  sub: string;
  /** e-mail (lower-case) the link was sent to */
  em: string;
}

export function mintClaimLinkToken(input: {
  invitationId: string;
  shellUserId: string;
  email: string;
}): string {
  return signToken<ClaimLinkClaims>(
    "claim-login",
    { inv: input.invitationId, sub: input.shellUserId, em: input.email },
    CLAIM_LINK_TTL_MS
  ).token;
}

export interface ClaimLinkUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

function consumedKey(nonce: string): string {
  // ≤ 64 chars (jti column); prefix keeps it apart from SSO JWT ids / tokrev:.
  return `claimlink:${createHash("sha256").update(nonce, "utf8").digest("base64url")}`;
}

/**
 * Verify + consume a claim-login token and activate the shell account.
 * Returns the activated user, or null for ANY failure (bad / expired /
 * reused token, invitation no longer pending, e-mail taken meanwhile,
 * read-only instance) — the caller (NextAuth authorize) only needs a yes/no.
 */
export async function consumeClaimLinkToken(token: unknown): Promise<ClaimLinkUser | null> {
  if (isReadonly()) return null;
  const v = verifyToken<ClaimLinkClaims>("claim-login", token);
  if (!v.ok) return null;
  const { inv, sub, em, n, exp } = v.claims;
  if (
    typeof inv !== "string" ||
    typeof sub !== "string" ||
    typeof em !== "string" ||
    typeof n !== "string" ||
    !em.includes("@")
  ) {
    return null;
  }

  let user: ClaimLinkUser | null = null;
  try {
    user = await db.transaction(async (tx) => {
      const consumed = await tx
        .insert(ssoConsumedTokens)
        .values({ jti: consumedKey(n), expiresAt: new Date(exp) })
        .onConflictDoNothing()
        .returning({ jti: ssoConsumedTokens.jti });
      if (consumed.length === 0) return null; // already used

      const [invite] = await tx
        .select({
          id: invitations.id,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
          targetShellUserId: invitations.targetShellUserId,
        })
        .from(invitations)
        .where(eq(invitations.id, inv))
        .for("update");
      if (
        !invite ||
        invite.status !== "pending" ||
        invite.targetShellUserId !== sub ||
        invite.expiresAt.getTime() < Date.now()
      ) {
        return null;
      }

      const [conflict] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, em), ne(users.id, sub)))
        .limit(1);
      if (conflict) return null;

      const [shell] = await tx
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          status: users.status,
          mergedIntoUserId: users.mergedIntoUserId,
          anonymizedAt: users.anonymizedAt,
        })
        .from(users)
        .where(eq(users.id, sub))
        .limit(1);
      if (
        !shell ||
        !shell.isActive ||
        shell.status === "rejected" ||
        shell.mergedIntoUserId !== null ||
        shell.anonymizedAt !== null
      ) {
        return null;
      }

      // Same activation as the password claim (api/claim/[token] POST),
      // minus the password: the owner can add one (or a passkey) later.
      await tx
        .update(users)
        .set({ email: em, status: "active", emailVerifiedAt: new Date() })
        .where(eq(users.id, sub));
      await tx
        .update(invitations)
        .set({ status: "used", usedByUserId: sub })
        .where(eq(invitations.id, invite.id));
      await tx
        .update(invitations)
        .set({ status: "superseded" })
        .where(
          and(
            eq(invitations.targetShellUserId, sub),
            eq(invitations.status, "pending"),
            ne(invitations.id, invite.id)
          )
        );

      return { id: shell.id, email: em, name: shell.name, role: shell.role, status: "active" as UserStatus };
    });
  } catch (err) {
    // e.g. users_email unique violation from a concurrent registration.
    console.error("[claim-link] activation failed", err);
    return null;
  }

  if (user) {
    recordEntityAudit({
      action: "user.claim_shell",
      actorUserId: null,
      entityId: null,
      after: { invitationId: inv, email: user.email, method: "email_link" },
    });
  }
  return user;
}

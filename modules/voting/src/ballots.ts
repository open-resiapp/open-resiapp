import "server-only";

import { hasPermission } from "@/lib/permissions";
import { McpError, validationError } from "@/lib/mcp/errors";
import type { Viewer } from "@/lib/mcp/principal";
import type { UserRole, VoteChoice } from "@/types";
import { votings } from "./db/schema";
import { validateCast, VALID_CHOICES, type CastFailure } from "./routes/api/ballots/cast.server";

// MCP ballot validation (BYT-20261117-001 §3/§6). validateBallotCast checks
// every rule (permission, voting active + deadline, electronic allowed,
// ownership, scope, items/choices) and computes the ballot hash. Writes
// nothing, so the MCP path can show the ballot and send a confirmation
// email before anything is stored. The rules themselves live in
// routes/api/ballots/cast.server.ts `validateCast`, shared with the web cast
// routes so the two paths cannot drift; this wrapper adds the permission
// check and maps failure codes to McpError. Electronic ballots are written
// only by cast.server.ts `recordConfirmedBallot` (web passkey / e-mail link,
// and the MCP email-link confirm via pending-ballots.ts).

export { VALID_CHOICES };

export interface IncomingItemChoice {
  itemId?: unknown;
  choice?: unknown;
}

export interface BallotCastInput {
  votingId: string;
  unitId: string;
  items: IncomingItemChoice[];
  /**
   * Paper ballot recorded by a vote counter / admin on behalf of `ownerId`.
   * Omitted = electronic ballot cast by the actor themself.
   */
  paper?: { ownerId: string };
  /**
   * Require an active OWNER membership on the unit (MCP ballot path). The
   * web route keeps its historical "any active membership" rule.
   */
  requireOwnerMembership?: boolean;
}

export interface ValidatedBallot {
  voting: typeof votings.$inferSelect;
  votingId: string;
  unitId: string;
  ownerId: string;
  voteType: "electronic" | "paper";
  marked: { itemId: string; choice: VoteChoice }[];
  ballotHash: string;
}

/** validateCast failure → the McpError the MCP tools have always thrown. */
function castFailureToMcp(f: CastFailure): McpError {
  switch (f.code) {
    case "VOTING_NOT_ACTIVE":
      return new McpError("voting_not_active", f.detail);
    case "VOTING_ENDED":
      return new McpError("voting_not_active", { exists: true, reason: "ended" });
    case "ELECTRONIC_NOT_ALLOWED":
      return new McpError("electronic_blocked", f.detail);
    case "NOT_UNIT_OWNER":
      return new McpError("not_unit_owner");
    case "UNIT_OUT_OF_SCOPE":
      return new McpError("unit_out_of_scope");
    case "INVALID_ITEM":
      return validationError("itemId");
    case "INVALID_CHOICE":
      return validationError("choice");
    case "DUPLICATE_ITEM":
      return validationError("items", { reason: "duplicate_item" });
    default:
      return new McpError("internal");
  }
}

/**
 * Validates a ballot without writing. Throws McpError:
 *   forbidden (details.kind = "paper" | "electronic"), voting_not_active
 *   (details.reason = "ended" once an electronic ballot is past endsAt),
 *   electronic_blocked (details.reason = "meeting" | "owners_quarter"),
 *   not_unit_owner, unit_out_of_scope, validation.itemId, validation.choice,
 *   validation.items (duplicate).
 */
export async function validateBallotCast(
  actor: Viewer,
  input: BallotCastInput
): Promise<ValidatedBallot> {
  const isPaper = Boolean(input.paper);
  const voterId = input.paper ? input.paper.ownerId : actor.userId;

  // Permission.
  if (isPaper) {
    if (!hasPermission(actor.role as UserRole, "recordPaperVote")) {
      throw new McpError("forbidden", { kind: "paper" });
    }
  } else if (!hasPermission(actor.role as UserRole, "vote")) {
    throw new McpError("forbidden", { kind: "electronic" });
  }

  const res = await validateCast({
    votingId: input.votingId,
    flatId: input.unitId,
    voterId,
    incoming: input.items,
    electronic: !isPaper,
    requireOwnerMembership: input.requireOwnerMembership,
  });
  if (!res.ok) throw castFailureToMcp(res);

  return {
    voting: res.voting,
    votingId: input.votingId,
    unitId: input.unitId,
    ownerId: voterId,
    voteType: isPaper ? "paper" : "electronic",
    marked: res.marked,
    ballotHash: res.ballotHash,
  };
}

export interface PersistedBallot {
  ballotId: string;
  ballotHash: string;
  recordedAt: Date;
  superseded: boolean;
}

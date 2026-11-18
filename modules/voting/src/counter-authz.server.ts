import "server-only";
// 2026-11-18 review — who may act as the vote counter of ONE voting: record /
// delete paper ballots, see participation, run the door list. The global
// `vote_counter` role no longer grants this for every voting; the voting's
// own `voteCounterId` does. Board (admin / active chairman — isBoard, the
// same authority as creating the voting) always may.
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { isBoard } from "@/lib/mcp/authz";
import type { Principal } from "@/lib/mcp/principal";
import { votings } from "./db/schema";

export type CounterActor = Pick<Principal, "userId" | "role"> &
  Partial<Pick<Principal, "status" | "boardRoles">>;

export function canRecordForVoting(
  p: CounterActor,
  voting: { voteCounterId: string | null } | null
): boolean {
  if (p.status !== undefined && p.status !== "active") return false;
  if (isBoard({ role: p.role, boardRoles: p.boardRoles ?? [] })) return true;
  return Boolean(voting?.voteCounterId && voting.voteCounterId === p.userId);
}

/** Loads the voting's counter and checks; false when the voting does not exist. */
export async function canRecordForVotingId(p: CounterActor, votingId: string): Promise<boolean> {
  const [v] = await db
    .select({ voteCounterId: votings.voteCounterId })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  return v ? canRecordForVoting(p, v) : false;
}

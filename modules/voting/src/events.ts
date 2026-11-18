import "server-only";
// Append-only voting audit log (BYT-20261118-002 §6). This module only
// INSERTs and SELECTs — there is deliberately no update / delete path for
// mod_voting_voting_events anywhere in the code base.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { votingEvents } from "./db/schema";

export type VotingEventKind =
  | "announced"
  | "closed"
  | "reopened"
  | "result_published"
  | "ballot_superseded"
  | "document_generated"
  | "minutes_finalised"
  | "mandate_revoked";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordVotingEvent(
  exec: Tx | typeof db,
  input: {
    votingId: string;
    kind: VotingEventKind;
    actorId: string | null;
    note?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await exec.insert(votingEvents).values({
    votingId: input.votingId,
    kind: input.kind,
    actorId: input.actorId,
    note: input.note ?? null,
    payload: input.payload ?? null,
  });
}

export interface VotingEventRow {
  id: string;
  kind: VotingEventKind;
  actorName: string | null;
  note: string | null;
  payload: unknown;
  createdAt: Date;
}

/** Full history of a voting, oldest first. No authz — callers gate it (board only). */
export async function listVotingEvents(votingId: string): Promise<VotingEventRow[]> {
  const rows = await db
    .select({
      id: votingEvents.id,
      kind: votingEvents.kind,
      actorName: users.name,
      note: votingEvents.note,
      payload: votingEvents.payload,
      createdAt: votingEvents.createdAt,
    })
    .from(votingEvents)
    .leftJoin(users, eq(users.id, votingEvents.actorId))
    .where(eq(votingEvents.votingId, votingId))
    .orderBy(asc(votingEvents.createdAt));
  return rows.map((r) => ({ ...r, kind: r.kind as VotingEventKind }));
}

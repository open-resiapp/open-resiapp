import "server-only";
// Voting officials (BYT-20261118-002 §2). Document content, not a
// permission — `votings.voteCounterId` stays the paper-recording permission.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { votingOfficials } from "./db/schema";
import type { OfficialInput, OfficialRole } from "./workflow/officials";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OfficialRow extends OfficialInput {
  id: string;
  idx: number;
}

export async function listOfficials(votingId: string): Promise<OfficialRow[]> {
  const rows = await db
    .select()
    .from(votingOfficials)
    .where(eq(votingOfficials.votingId, votingId))
    .orderBy(asc(votingOfficials.role), asc(votingOfficials.idx));
  return rows.map((r) => ({
    id: r.id,
    idx: r.idx,
    role: r.role as OfficialRole,
    name: r.name,
    userId: r.userId,
    refusedToSign: r.refusedToSign,
    refusalStatement: r.refusalStatement,
  }));
}

/** Replace the whole officials list (create / update / delete in one go). */
export async function replaceOfficials(
  tx: Tx,
  votingId: string,
  officials: OfficialInput[]
): Promise<void> {
  await tx.delete(votingOfficials).where(eq(votingOfficials.votingId, votingId));
  if (officials.length === 0) return;
  await tx.insert(votingOfficials).values(
    officials.map((o, idx) => ({ votingId, idx, ...o }))
  );
}

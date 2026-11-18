import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import type { Country } from "@/types";
import { sendVoteConfirmation } from "./email/vote-confirmation";
import { describeBallot, type MarkedChoice } from "./routes/api/ballots/cast.server";

// BYT-20261118-009 §6: ONE receipt for every confirmed electronic ballot —
// web e-mail link, web passkey and MCP (§14a ods. 5 for SK). Best effort:
// fire-and-forget, never blocks or fails the recorded vote.

export function sendBallotReceipt(input: {
  votingId: string;
  flatId: string;
  voterId: string;
  marked: MarkedChoice[];
  ballotHash: string;
  recordedAt: Date;
  method: "passkey" | "email";
  country: Country;
  locale: string;
}): void {
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
      timestamp: input.recordedAt,
      ballotHash: input.ballotHash,
      method: input.method,
      country: input.country,
      locale: input.locale,
    });
  })().catch((e) => console.error("[voting] receipt e-mail failed:", e));
}

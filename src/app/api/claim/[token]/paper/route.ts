import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limiter";

// POST — "I have no e-mail / smartphone": the owner holding a valid claim
// token asks the board for paper communication. Sets users.paper_only so the
// board sees it; the claim itself stays open (token is NOT consumed). The
// board clears the flag via PATCH /api/admin/shell-users/paper.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const limited = checkRateLimit(req, { maxRequests: 5, windowMs: 15 * 60 * 1000 }, "claim-paper");
  if (limited) return limited;

  const { token } = await ctx.params;
  const [invite] = await db
    .select({
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      targetShellUserId: invitations.targetShellUserId,
    })
    .from(invitations)
    .where(eq(invitations.token, token));
  if (!invite || !invite.targetShellUserId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "used" }, { status: 410 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  await db
    .update(users)
    .set({ paperOnly: true })
    .where(eq(users.id, invite.targetShellUserId));
  return NextResponse.json({ ok: true });
}

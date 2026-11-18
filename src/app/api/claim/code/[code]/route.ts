import { NextRequest, NextResponse } from "next/server";

import { resolveShortCode } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/rate-limiter";

// GET — turn the short code from a paper claim letter into the claim token
// (the page then continues at /claim/<token>). ~49 bits of entropy plus a
// tight per-IP limit; the token itself is still single-use and expires.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
) {
  const limited = checkRateLimit(req, { maxRequests: 8, windowMs: 15 * 60 * 1000 }, "claim-code");
  if (limited) return limited;
  const { code } = await ctx.params;
  const token = await resolveShortCode(decodeURIComponent(code));
  if (!token) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ token });
}

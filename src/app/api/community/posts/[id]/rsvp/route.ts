import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { communityPosts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setSocialEventRsvp } from "@/lib/community.server";
import { isMcpError } from "@/lib/mcp/errors";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { principalFromSession } from "@/lib/mcp/principal";
import {
  MeetingError,
  canManageAttendance,
  loadMeetingVotingByPost,
  setMeetingRsvp,
} from "@modules/voting/src/attendance";
import type { UserRole } from "@/types";

// RSVP to an event post. Errors are stable codes (UI maps them to the
// Feed / MeetingAttendance catalogs) — never prose (BYT-20261118-001 §2).
//
// Owners' meeting posts (eventKind = owners_meeting) are handled by the
// voting module: only eligible owners of the meeting voting's scope may
// answer, answers close when the meeting starts, and the board (admin /
// chairman / vote counter) may answer FOR an owner (`ownerId`, source board).

const VALID_STATUSES = ["yes", "no", "maybe"] as const;
type RsvpStatus = (typeof VALID_STATUSES)[number];

function err(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

async function loadPost(id: string) {
  const [post] = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      eventKind: communityPosts.eventKind,
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, id))
    .limit(1);
  return post ?? null;
}

async function meetingRsvp(
  session: Session,
  postId: string,
  status: RsvpStatus | null,
  ownerId: unknown
) {
  if (!(await isModuleEnabled("voting"))) return err("MEETING_RSVP_NOT_ELIGIBLE", 404);
  let userId = session.user.id;
  let source: "app" | "board" = "app";
  let recordedById: string | null = null;
  if (typeof ownerId === "string" && ownerId && ownerId !== session.user.id) {
    // Board answers for an owner who phoned (spec §2).
    // Board, or the vote counter of THIS meeting's voting.
    const voting = await loadMeetingVotingByPost(postId);
    if (!canManageAttendance(await principalFromSession(session), voting)) {
      return err("FORBIDDEN", 403);
    }
    userId = ownerId;
    source = "board";
    recordedById = session.user.id;
  }
  try {
    const result = await setMeetingRsvp({ postId, userId, status, source, recordedById });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MeetingError) return err(e.code, e.status);
    throw e;
  }
}

// Social events: setSocialEventRsvp (src/lib/community.server.ts), shared
// with the MCP rsvp_event / clear_event_rsvp actions (BYT-20261118-012).
// It refuses a post the viewer cannot see (feed rule) as POST_NOT_FOUND.
// Owners' meetings need no feed check: setMeetingRsvp only accepts
// eligible owners of the meeting voting's scope, and board answers for an
// owner are gated by canManageAttendance.
async function socialRsvp(session: Session, postId: string, status: RsvpStatus | null) {
  try {
    const result = await setSocialEventRsvp(
      { userId: session.user.id, role: session.user.role as UserRole },
      postId,
      status
    );
    return NextResponse.json(result);
  } catch (e) {
    if (isMcpError(e)) {
      if (e.code === "forbidden") return err("FORBIDDEN", 403);
      if (e.code === "not_found") return err("POST_NOT_FOUND", 404);
      if (e.details?.reason === "events_only") return err("RSVP_EVENTS_ONLY", 400);
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", 401);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = body.status as RsvpStatus;
  if (!VALID_STATUSES.includes(status)) return err("RSVP_INVALID_STATUS", 400);

  const post = await loadPost(id);
  if (!post) return err("POST_NOT_FOUND", 404);
  if (post.type !== "event") return err("RSVP_EVENTS_ONLY", 400);

  if (post.eventKind === "owners_meeting") {
    return meetingRsvp(session, id, status, body.ownerId);
  }

  return socialRsvp(session, id, status);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", 401);

  const { id } = await params;
  const post = await loadPost(id);
  if (post?.eventKind === "owners_meeting") {
    // Withdraw ("Zrušiť odpoveď"); the board may clear an owner's answer
    // with ?ownerId=… .
    const ownerId = new URL(request.url).searchParams.get("ownerId");
    return meetingRsvp(session, id, null, ownerId);
  }

  if (!post || post.type !== "event") return NextResponse.json({ ok: true });
  const res = await socialRsvp(session, id, null);
  return res.ok ? NextResponse.json({ ok: true }) : res;
}

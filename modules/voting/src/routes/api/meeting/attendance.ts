import "server-only";

import { NextRequest, NextResponse } from "next/server";

import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { principalFromSession } from "@/lib/mcp/principal";
import {
  MeetingError,
  canManageAttendance,
  getAttendanceList,
  getMeetingRsvpOverview,
  loadMeetingVoting,
  recordAttendance,
  removeAttendance,
  setAttendanceLeft,
} from "@modules/voting/src/attendance";

// BYT-20261118-001 §5, §6 — board overview (RSVP answers) and the door list.
// Board only (admin / chairman / vote counter): names are visible here and
// nowhere else. One GET per visit + one after each own mutation; no polling.

type Ctx = { params: Promise<{ id: string }> };

function err(code: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: code, ...(details ?? {}) }, { status });
}

async function gate(votingId: string): Promise<NextResponse | Session> {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", 401);
  // Board, or the vote counter of THIS voting (votings.voteCounterId).
  const voting = await loadMeetingVoting(votingId);
  if (!canManageAttendance(await principalFromSession(session), voting)) {
    return err("FORBIDDEN", 403);
  }
  return session;
}

export async function GET(_request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const g = await gate(id);
  if (g instanceof NextResponse) return g;
  const [overview, list] = await Promise.all([getMeetingRsvpOverview(id), getAttendanceList(id)]);
  if (!overview || !list) return err("NOT_FOUND", 404);
  return NextResponse.json({ overview, attendance: list });
}

/**
 * Body: { action: "present" | "represented" | "remove" | "left" | "back",
 *         ownerId, mandateId?, representativeName?, idCheckMethod?, note? }
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const g = await gate(id);
  if (g instanceof NextResponse) return g;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  if (!ownerId) return err("INVALID_REQUEST", 400);

  try {
    switch (body.action) {
      case "present":
      case "represented":
        await recordAttendance({
          votingId: id,
          ownerId,
          status: body.action,
          mandateId: typeof body.mandateId === "string" ? body.mandateId : null,
          representativeName:
            typeof body.representativeName === "string" ? body.representativeName : null,
          idCheckMethod: body.idCheckMethod === "photo_id" ? "photo_id" : "known_in_person",
          note: typeof body.note === "string" ? body.note : null,
          actorId: g.user.id,
        });
        break;
      case "remove":
        await removeAttendance(id, ownerId);
        break;
      case "left":
      case "back":
        await setAttendanceLeft(id, ownerId, body.action === "left");
        break;
      default:
        return err("INVALID_REQUEST", 400);
    }
  } catch (e) {
    if (e instanceof MeetingError) return err(e.code, e.status, e.details);
    throw e;
  }
  return NextResponse.json({ ok: true });
}

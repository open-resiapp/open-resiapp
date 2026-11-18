import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isBoard } from "@/lib/mcp/authz";
import { principalFromSession } from "@/lib/mcp/principal";
import { hasPermission } from "@/lib/permissions";
import { routing } from "@/i18n/routing";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import type { UserRole } from "@/types";
import {
  MeetingError,
  announceMeeting,
  cancelMeeting,
  canManageAttendance,
  changeMeeting,
  getOwnMeetingState,
} from "@modules/voting/src/attendance";
import {
  sendMeetingChanges,
  sendMeetingInvitations,
} from "@modules/voting/src/meeting-notify.server";

// BYT-20261118-001 — the meeting around a meeting voting.
//   GET  → the CALLER's own state (RSVP, attendance line) + aggregate counts
//          only — never other owners' names (§9).
//   POST → board (admin / active chairman — same authority as createVoting):
//          announce | invite | change | notify_change | cancel.

type Ctx = { params: Promise<{ id: string }> };

function err(code: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: code, ...(details ?? {}) }, { status });
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", 401);
  const role = session.user.role as UserRole;
  const principal = await principalFromSession(session);
  // Caretaker / tenant see nothing of this (§9).
  if (!hasPermission(role, "vote") && !canManageAttendance(principal)) {
    return err("FORBIDDEN", 403);
  }
  const { id } = await params;
  const state = await getOwnMeetingState(id, session.user.id);
  if (!state) return err("NOT_FOUND", 404);
  return NextResponse.json(state);
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return err("UNAUTHORIZED", 401);
  const principal = await principalFromSession(session);
  if (principal.status !== "active" || !isBoard(principal)) return err("FORBIDDEN", 403);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locale =
    typeof body.locale === "string" && (routing.locales as readonly string[]).includes(body.locale)
      ? body.locale
      : routing.defaultLocale;

  try {
    switch (body.action) {
      case "announce": {
        const postId = await announceMeeting(
          id,
          session.user.id,
          typeof body.place === "string" ? body.place : null
        );
        return NextResponse.json({ ok: true, postId }, { status: 201 });
      }
      case "invite":
        return NextResponse.json(await sendMeetingInvitations(id, locale));
      case "change": {
        const startsAt =
          typeof body.startsAt === "string" && body.startsAt ? new Date(body.startsAt) : undefined;
        if (startsAt && Number.isNaN(startsAt.getTime())) return err("INVALID_REQUEST", 400);
        const place = typeof body.place === "string" ? body.place : undefined;
        await changeMeeting(id, { startsAt, place });
        return NextResponse.json({ ok: true });
      }
      case "notify_change":
        return NextResponse.json(await sendMeetingChanges(id, { cancelled: false, locale }));
      case "cancel": {
        await cancelMeeting(id);
        return NextResponse.json(await sendMeetingChanges(id, { cancelled: true, locale }));
      }
      default:
        return err("INVALID_REQUEST", 400);
    }
  } catch (e) {
    if (e instanceof MeetingError) return err(e.code, e.status, e.details);
    if (e instanceof ConfirmationUnavailableError) return err("CONFIRMATION_UNAVAILABLE", 503);
    throw e;
  }
}

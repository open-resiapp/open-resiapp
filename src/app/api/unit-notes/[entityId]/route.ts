import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  boardUnitPath,
  clearUnitNote,
  getUnitNote,
  saveUnitNote,
  type UnitNoteResult,
} from "@/lib/unit-notes.server";

// Internal unit note — BYT-20261118-005 Phase C. Board only; every other
// caller gets 404 (no hint that a note exists).

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

function respond(result: UnitNoteResult) {
  if (result.ok) return NextResponse.json({ note: result.note });
  const status = result.code === "unit_note.conflict" ? 409 : 400;
  return NextResponse.json(
    { error: result.code, code: result.code, current: result.current ?? null },
    { status }
  );
}

type Ctx = { params: Promise<{ entityId: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entityId } = await params;
  if (!(await boardUnitPath(session.user.id, entityId))) return notFound();
  return NextResponse.json({ note: await getUnitNote(entityId) });
}

// PUT { body, expectedUpdatedAt: string | null } — create / edit.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entityId } = await params;
  if (!(await boardUnitPath(session.user.id, entityId))) return notFound();
  const json = (await request.json().catch(() => ({}))) as {
    body?: unknown;
    expectedUpdatedAt?: unknown;
  };
  return respond(
    await saveUnitNote({
      entityId,
      actorUserId: session.user.id,
      body: typeof json.body === "string" ? json.body : "",
      expectedUpdatedAt:
        typeof json.expectedUpdatedAt === "string" ? json.expectedUpdatedAt : null,
    })
  );
}

// DELETE ?expectedUpdatedAt=… — clear (row deleted).
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entityId } = await params;
  if (!(await boardUnitPath(session.user.id, entityId))) return notFound();
  const expected = new URL(request.url).searchParams.get("expectedUpdatedAt");
  return respond(
    await clearUnitNote({
      entityId,
      actorUserId: session.user.id,
      expectedUpdatedAt: expected || null,
    })
  );
}

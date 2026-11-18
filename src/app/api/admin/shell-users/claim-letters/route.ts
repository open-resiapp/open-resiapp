import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createPaperLetters, listPendingShellUsers } from "@/lib/invitations";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Bulk paper claim letters ("Listy pre vlastníkov bez účtu"). Board / admin
// with manageUsers only. POST issues NEW 60-day claims (one per owner) and
// returns their links + short codes for the PDF; the previous open claims stay
// valid until used or expired.

async function guard() {
  const session = await auth();
  if (!session) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const root = await getCommunityRoot();
  if (!root) {
    return { error: NextResponse.json({ error: "community_missing" }, { status: 404 }) };
  }
  return { session, root };
}

// GET — owners without an account (one row per person) for the dialog.
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const rows = await listPendingShellUsers(g.root.id);
  const people = new Map<
    string,
    { id: string; name: string; email: string | null; paperOnly: boolean; flats: string[] }
  >();
  for (const r of rows) {
    const cur = people.get(r.id) ?? {
      id: r.id,
      name: r.name,
      email: r.email,
      paperOnly: r.paperOnly,
      flats: [],
    };
    if (r.flatNumber) cur.flats.push(r.flatNumber);
    people.set(r.id, cur);
  }
  return NextResponse.json({ owners: [...people.values()] });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    shellIds?: unknown;
    onlyWithoutEmail?: unknown;
    locale?: unknown;
  };
  const shellIds = Array.isArray(body.shellIds)
    ? body.shellIds.filter((x): x is string => typeof x === "string")
    : undefined;

  const letters = await createPaperLetters({
    rootId: g.root.id,
    createdById: g.session.user.id,
    locale: typeof body.locale === "string" ? body.locale : undefined,
    shellIds,
    onlyWithoutEmail: body.onlyWithoutEmail === true,
  });
  return NextResponse.json(
    {
      communityName: g.root.name,
      letters: letters.map((l) => ({ ...l, expiresAt: l.expiresAt.toISOString() })),
    },
    { status: 201 }
  );
}

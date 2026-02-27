import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { mandates, votings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "grantMandate")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { votingId, toOwnerId } = body;

  if (!votingId || !toOwnerId) {
    return NextResponse.json(
      { error: "votingId a toOwnerId sú povinné" },
      { status: 400 }
    );
  }

  // Check voting is active
  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  if (!voting || voting.status !== "active") {
    return NextResponse.json(
      { error: "Hlasovanie nie je aktívne" },
      { status: 400 }
    );
  }

  // Check if mandate already exists
  const existing = await db
    .select()
    .from(mandates)
    .where(
      and(
        eq(mandates.votingId, votingId),
        eq(mandates.fromOwnerId, session.user.id),
        eq(mandates.isActive, true)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Už máte aktívne splnomocnenie pre toto hlasovanie" },
      { status: 400 }
    );
  }

  const [mandate] = await db
    .insert(mandates)
    .values({
      votingId,
      fromOwnerId: session.user.id,
      toOwnerId,
    })
    .returning();

  return NextResponse.json(mandate, { status: 201 });
}

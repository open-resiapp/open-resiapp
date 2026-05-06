import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, housingUnitData } from "@/db/schema";
import { mandates, votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createVoting")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");

  if (!votingId) {
    return NextResponse.json({ error: "votingId je povinný" }, { status: 400 });
  }

  const fromOwner = alias(users, "fromOwner");
  const toOwner = alias(users, "toOwner");
  const verifiedByAdmin = alias(users, "verifiedByAdmin");

  // Phase 9.2: flat number now comes from housing_unit_data joined
  // on the mandate's from_entity_id (== flat entity id).
  const rows = await db
    .select({
      id: mandates.id,
      fromOwnerName: fromOwner.name,
      fromFlatNumber: housingUnitData.flatNumber,
      toOwnerName: toOwner.name,
      paperDocumentConfirmed: mandates.paperDocumentConfirmed,
      verifiedByAdminName: verifiedByAdmin.name,
      verificationDate: mandates.verificationDate,
      verificationNote: mandates.verificationNote,
      isActive: mandates.isActive,
      createdAt: mandates.createdAt,
    })
    .from(mandates)
    .leftJoin(fromOwner, eq(mandates.fromOwnerId, fromOwner.id))
    .leftJoin(toOwner, eq(mandates.toOwnerId, toOwner.id))
    .leftJoin(housingUnitData, eq(housingUnitData.entityId, mandates.fromEntityId))
    .leftJoin(verifiedByAdmin, eq(mandates.verifiedByAdminId, verifiedByAdmin.id))
    .where(eq(mandates.votingId, votingId));

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "grantMandate")) {
    return NextResponse.json(
      { error: "Iba administrátor môže vytvárať splnomocnenia" },
      { status: 403 }
    );
  }

  const body = await request.json();
  // Accept either fromEntityId (canonical) or legacy fromFlatId from older
  // clients — both refer to the housing_unit entity id.
  const fromEntityId = body.fromEntityId ?? body.fromFlatId;
  const { votingId, fromOwnerId, toOwnerId, paperDocumentConfirmed, verificationNote } = body;

  if (!votingId || !fromEntityId || !fromOwnerId || !toOwnerId) {
    return NextResponse.json(
      { error: "votingId, fromEntityId, fromOwnerId a toOwnerId sú povinné" },
      { status: 400 }
    );
  }

  if (!paperDocumentConfirmed) {
    return NextResponse.json(
      {
        error:
          "Splnomocnenie vyžaduje potvrdenie listinného dokumentu s úradne osvedčeným podpisom",
      },
      { status: 400 }
    );
  }

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

  // Check if mandate already exists for this flat in this voting.
  const existing = await db
    .select()
    .from(mandates)
    .where(
      and(
        eq(mandates.votingId, votingId),
        eq(mandates.fromEntityId, fromEntityId),
        eq(mandates.isActive, true)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Pre tento byt už existuje aktívne splnomocnenie v tomto hlasovaní" },
      { status: 400 }
    );
  }

  // Chain check.
  const chainCheck = await db
    .select()
    .from(mandates)
    .where(
      and(
        eq(mandates.votingId, votingId),
        eq(mandates.fromOwnerId, toOwnerId),
        eq(mandates.isActive, true)
      )
    )
    .limit(1);

  if (chainCheck.length > 0) {
    return NextResponse.json(
      {
        error:
          "Príjemca splnomocnenia už delegoval svoj hlas — reťazenie splnomocnení nie je povolené",
      },
      { status: 400 }
    );
  }

  const [mandate] = await db
    .insert(mandates)
    .values({
      votingId,
      fromOwnerId,
      fromEntityId,
      toOwnerId,
      paperDocumentConfirmed: true,
      verifiedByAdminId: session.user.id,
      verificationDate: new Date(),
      verificationNote: verificationNote || null,
    })
    .returning();

  return NextResponse.json(mandate, { status: 201 });
}

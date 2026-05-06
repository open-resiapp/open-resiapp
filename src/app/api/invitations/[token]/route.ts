import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, eq } from "drizzle-orm";

import { db } from "@/db";
import { invitations, entities, housingUnitData } from "@/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Phase 9.1d: read flatNumber + entranceName from entities tree.
  // invitations.flat_id == housing_unit entity id (Phase 4 backfill).
  const flat = aliasedTable(entities, "flat");
  const entrance = aliasedTable(entities, "entrance");
  const result = await db
    .select({
      id: invitations.id,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      flatNumber: housingUnitData.flatNumber,
      entranceName: entrance.name,
    })
    .from(invitations)
    .leftJoin(flat, eq(flat.id, invitations.flatId))
    .leftJoin(housingUnitData, eq(housingUnitData.entityId, flat.id))
    .leftJoin(entrance, eq(entrance.id, flat.parentId))
    .where(eq(invitations.token, token))
    .limit(1);

  if (result.length === 0) {
    return NextResponse.json(
      { valid: false, reason: "not_found" },
      { status: 404 }
    );
  }

  const invitation = result[0];

  if (invitation.status === "used") {
    return NextResponse.json(
      { valid: false, reason: "used" },
      { status: 410 }
    );
  }

  if (invitation.status === "expired" || new Date(invitation.expiresAt) < new Date()) {
    return NextResponse.json(
      { valid: false, reason: "expired" },
      { status: 410 }
    );
  }

  return NextResponse.json({
    valid: true,
    role: invitation.role,
    flatNumber: invitation.flatNumber,
    entranceName: invitation.entranceName,
  });
}

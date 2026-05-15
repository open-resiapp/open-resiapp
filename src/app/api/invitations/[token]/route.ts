import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { invitations, entities } from "@/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Phase 2b: flatNumber from entities.data jsonb; entranceName from
  // the parent entity. invitations.entityId == unit entity id.
  const flat = aliasedTable(entities, "flat");
  const entrance = aliasedTable(entities, "entrance");
  const result = await db
    .select({
      id: invitations.id,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      flatNumber: sql<string | null>`${flat.data}->>'flat_number'`,
      entranceName: entrance.name,
    })
    .from(invitations)
    .leftJoin(flat, eq(flat.id, invitations.entityId))
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

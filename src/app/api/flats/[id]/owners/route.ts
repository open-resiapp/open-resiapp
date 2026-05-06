import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;

  // Phase 9.1b: read owners via memberships at the housing_unit entity
  // (entity.id == flat.id from the 0023 backfill, so the path param
  // continues to work with no client change).
  const result = await db
    .select({
      userId: users.id,
      userName: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(eq(memberships.entityId, id), eq(memberships.status, "active"))
    );

  return NextResponse.json(result);
}

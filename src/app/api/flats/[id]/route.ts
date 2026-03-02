import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { flats, userFlats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { flatNumber, floor, area, shareNumerator, shareDenominator, entranceId } = body;

  const updateData: Record<string, unknown> = {};
  if (flatNumber !== undefined) updateData.flatNumber = flatNumber;
  if (floor !== undefined) updateData.floor = floor;
  if (area !== undefined) updateData.area = area;
  if (shareNumerator !== undefined) updateData.shareNumerator = shareNumerator;
  if (shareDenominator !== undefined) updateData.shareDenominator = shareDenominator;
  if (entranceId !== undefined) updateData.entranceId = entranceId;

  const [updated] = await db
    .update(flats)
    .set(updateData)
    .where(eq(flats.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Byt nenájdený" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  // Check if flat has assigned users
  const flatUsers = await db
    .select({ id: userFlats.id })
    .from(userFlats)
    .where(eq(userFlats.flatId, id))
    .limit(1);

  if (flatUsers.length > 0) {
    return NextResponse.json(
      { error: "Nemožno zmazať byt s priradenými používateľmi. Najprv odpojte používateľov." },
      { status: 400 }
    );
  }

  const [deleted] = await db
    .delete(flats)
    .where(eq(flats.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Byt nenájdený" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

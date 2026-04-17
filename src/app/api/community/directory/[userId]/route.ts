import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { directoryEntries } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { UserRole } from "@/types";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if ((session.user.role as UserRole) !== "admin") {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { userId } = await params;
  await db.delete(directoryEntries).where(eq(directoryEntries.userId, userId));

  return NextResponse.json({ ok: true });
}

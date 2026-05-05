import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: "Neautorizovaný prístup" },
      { status: 401 }
    );
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  const [pending] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.status, "pending")))
    .limit(1);

  if (!pending) {
    return NextResponse.json(
      { error: "Žiadosť nebola nájdená" },
      { status: 404 }
    );
  }

  await db
    .update(users)
    .set({ status: "rejected", isActive: false })
    .where(eq(users.id, id));

  return NextResponse.json({ success: true });
}

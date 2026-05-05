import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
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

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.status, "pending"))
    .orderBy(asc(users.createdAt));

  const verified = rows.filter((r) => r.emailVerifiedAt !== null);
  const unverified = rows.filter((r) => r.emailVerifiedAt === null);

  return NextResponse.json({ verified, unverified });
}

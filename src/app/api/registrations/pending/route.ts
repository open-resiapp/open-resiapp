import { NextResponse } from "next/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
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

  // Filter out shell users (passwordHash IS NULL). Shells are handled
  // by /api/admin/shell-users + the dedicated pending shell-users page
  // (BYT-20260512-001). Only bulk-QR self-registrants appear here.
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
    .where(and(eq(users.status, "pending"), isNotNull(users.passwordHash)))
    .orderBy(asc(users.createdAt));

  const verified = rows.filter((r) => r.emailVerifiedAt !== null);
  const unverified = rows.filter((r) => r.emailVerifiedAt === null);

  return NextResponse.json({ verified, unverified });
}

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { invitations } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const { role, flatId, expiresInDays = 7 } = body;

  if (!role || !["owner", "tenant", "admin", "vote_counter", "caretaker"].includes(role)) {
    return NextResponse.json(
      { error: "Neplatná rola" },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const [invitation] = await db
    .insert(invitations)
    .values({
      token,
      role,
      entityId: flatId || null,
      expiresAt,
      createdById: session.user.id,
    })
    .returning({
      id: invitations.id,
      token: invitations.token,
      expiresAt: invitations.expiresAt,
    });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const url = `${baseUrl}/register/${invitation.token}`;

  return NextResponse.json(
    { token: invitation.token, url, expiresAt: invitation.expiresAt },
    { status: 201 }
  );
}

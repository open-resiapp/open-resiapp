import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, invitations, userFlats } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token, name, email, password, phone } = body;

  if (!token || !name || !email || !password) {
    return NextResponse.json(
      { error: "Meno, email a heslo sú povinné" },
      { status: 400 }
    );
  }

  // Validate token
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, token),
        eq(invitations.status, "pending")
      )
    )
    .limit(1);

  if (!invitation) {
    return NextResponse.json(
      { error: "Neplatný alebo použitý odkaz" },
      { status: 400 }
    );
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: "Platnosť odkazu vypršala" },
      { status: 400 }
    );
  }

  // Check for existing email
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Používateľ s týmto emailom už existuje" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      phone: phone || null,
      role: invitation.role,
      flatId: invitation.flatId, // Phase 1 compat
    })
    .returning({ id: users.id });

  // Insert into junction table
  if (invitation.flatId) {
    await db.insert(userFlats).values({
      userId: newUser.id,
      flatId: invitation.flatId,
    });
  }

  // Mark invitation as used
  await db
    .update(invitations)
    .set({
      status: "used",
      usedByUserId: newUser.id,
    })
    .where(eq(invitations.id, invitation.id));

  return NextResponse.json({ success: true }, { status: 201 });
}

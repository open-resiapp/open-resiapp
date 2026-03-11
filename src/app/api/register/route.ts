import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, invitations, userFlats, consentRecords } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { token, name, email, password, phone, consents } = body;

  if (!token || !name || !email || !password) {
    return NextResponse.json(
      { error: "Meno, email a heslo sú povinné" },
      { status: 400 }
    );
  }

  if (!consents?.data_processing) {
    return NextResponse.json(
      { error: "Súhlas so spracovaním osobných údajov je povinný" },
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

  // Record consent
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");

  const consentValues = [
    {
      userId: newUser.id,
      consentType: "data_processing" as const,
      action: "granted" as const,
      policyVersion: CURRENT_POLICY_VERSION,
      ipAddress: ip?.split(",")[0]?.trim() || null,
      userAgent,
    },
  ];

  if (consents.communication) {
    consentValues.push({
      userId: newUser.id,
      consentType: "communication" as const,
      action: "granted" as const,
      policyVersion: CURRENT_POLICY_VERSION,
      ipAddress: ip?.split(",")[0]?.trim() || null,
      userAgent,
    });
  }

  await db.insert(consentRecords).values(consentValues);

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

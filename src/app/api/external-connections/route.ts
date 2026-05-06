import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { externalConnections, pairingRequests } from "@/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { createPairingRequest } from "@/lib/pairing";
import { sendPairingInvitation } from "@/lib/email";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { UserRole, ApiKeyPermission, ConnectionType } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = (session.user?.role || "owner") as UserRole;
  if (!hasPermission(role, "manageApiKeys")) {
    return NextResponse.json({ error: "Nedostatočné oprávnenia" }, { status: 403 });
  }

  const connections = await db
    .select()
    .from(externalConnections)
    .orderBy(desc(externalConnections.createdAt));

  const pendingPairings = await db
    .select()
    .from(pairingRequests)
    .where(
      or(
        eq(pairingRequests.status, "pending"),
      )
    )
    .orderBy(desc(pairingRequests.createdAt));

  return NextResponse.json({
    connections,
    pendingPairings,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = (session.user?.role || "owner") as UserRole;
  if (!hasPermission(role, "manageApiKeys")) {
    return NextResponse.json({ error: "Nedostatočné oprávnenia" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, connectionType, permissions } = body;

    if (!email || !connectionType) {
      return NextResponse.json(
        { error: "Email a typ prepojenia sú povinné" },
        { status: 400 }
      );
    }

    const validTypes: ConnectionType[] = ["druzstvo", "energy", "housekeeper", "other"];
    if (!validTypes.includes(connectionType)) {
      return NextResponse.json(
        { error: "Neplatný typ prepojenia" },
        { status: 400 }
      );
    }

    const validPermissions: ApiKeyPermission[] = ["read", "read_write", "full"];
    const perm = permissions || "read";
    if (!validPermissions.includes(perm)) {
      return NextResponse.json(
        { error: "Neplatné oprávnenie" },
        { status: 400 }
      );
    }

    const { partA, pairingId } = await createPairingRequest({
      email,
      connectionType,
      permissions: perm,
      createdById: session.user!.id!,
    });

    // Get community root info for the email
    const buildingInfo = await getCommunityRoot();
    const buildingName = buildingInfo?.name || "OpenResiApp";
    const buildingUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000";

    // Send email with Part A
    await sendPairingInvitation({
      recipientEmail: email,
      buildingName,
      buildingUrl,
      partA,
      expiryHours: 1,
    });

    return NextResponse.json({
      success: true,
      pairingId,
      email,
      message: `Párovací kód bol odoslaný na ${email}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Nepodarilo sa vytvoriť prepojenie" },
      { status: 500 }
    );
  }
}

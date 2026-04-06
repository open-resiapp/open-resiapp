import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { externalConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { createPairingRequest } from "@/lib/pairing";
import type { UserRole, ConnectionType, ApiKeyPermission } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user?.role || "owner") as UserRole;
  if (!hasPermission(role, "manageApiKeys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [connection] = await db
    .select()
    .from(externalConnections)
    .where(eq(externalConnections.id, id))
    .limit(1);

  if (!connection || !connection.isActive) {
    return NextResponse.json(
      { error: "Connection not found or inactive" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const { email } = body;

  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 }
    );
  }

  const { partA, pairingId } = await createPairingRequest({
    email,
    connectionType: connection.type as ConnectionType,
    permissions: connection.permissions as ApiKeyPermission,
    createdById: session.user.id,
    rotationForConnectionId: connection.id,
  });

  return NextResponse.json({
    partA,
    pairingId,
    connectionId: connection.id,
  });
}

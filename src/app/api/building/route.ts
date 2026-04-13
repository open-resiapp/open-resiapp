import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { building } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const [result] = await db.select().from(building).limit(1);

  if (!result) {
    return NextResponse.json(null);
  }

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { name, address, ico, votingMethod, legalNotice, country, governanceModel } = body;

  const [existing] = await db.select().from(building).limit(1);

  if (!existing) {
    // Create building if it doesn't exist
    if (!name || !address) {
      return NextResponse.json(
        { error: "Názov a adresa sú povinné" },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(building)
      .values({
        name,
        address,
        ico: ico || null,
        votingMethod: votingMethod || "per_share",
        legalNotice: legalNotice || null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (address !== undefined) updateData.address = address;
  if (ico !== undefined) updateData.ico = ico;
  if (votingMethod !== undefined) updateData.votingMethod = votingMethod;
  if (legalNotice !== undefined) updateData.legalNotice = legalNotice;
  if (country !== undefined) updateData.country = country;
  if (governanceModel !== undefined) updateData.governanceModel = governanceModel;

  const [updated] = await db
    .update(building)
    .set(updateData)
    .where(eq(building.id, existing.id))
    .returning();

  return NextResponse.json(updated);
}

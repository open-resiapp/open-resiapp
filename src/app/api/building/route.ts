import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createEntity } from "@/lib/entity-tree";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { rootDataPatch } from "@/lib/db/entity-data";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const root = await getCommunityRoot();
  return NextResponse.json(root ?? null);
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

  // Phase 9.1d: building lives as root entity + housing_root_data.
  const existing = await getCommunityRoot();

  if (!existing) {
    // Bootstrap: create the root entity and its extension data.
    if (!name || !address) {
      return NextResponse.json(
        { error: "Názov a adresa sú povinné" },
        { status: 400 }
      );
    }
    const root = await createEntity({
      parentId: null,
      kind: "community",
      name,
    });
    const bootstrapValues = {
      address,
      ico: ico || null,
      votingMethod: votingMethod || "per_share",
      country: country || "sk",
      governanceModel: governanceModel || "chairman_council",
      legalNotice: legalNotice || null,
    };
    // Phase 8a: dual-write removed — entities.data is the only target.
    await db
      .update(entities)
      .set({
        data: sql`${entities.data} || ${JSON.stringify(rootDataPatch(bootstrapValues))}::jsonb`,
      })
      .where(eq(entities.id, root.id));
    const created = await getCommunityRoot();
    return NextResponse.json(created, { status: 201 });
  }

  if (name !== undefined) {
    await db
      .update(entities)
      .set({ name })
      .where(eq(entities.id, existing.id));
  }
  // Phase 8a: dual-write removed — entities.data is the only target.
  const dataPatch = rootDataPatch({
    address,
    ico,
    votingMethod,
    country,
    governanceModel,
    legalNotice,
  });
  if (Object.keys(dataPatch).length > 0) {
    await db
      .update(entities)
      .set({
        data: sql`${entities.data} || ${JSON.stringify(dataPatch)}::jsonb`,
      })
      .where(eq(entities.id, existing.id));
  }

  const updated = await getCommunityRoot();
  return NextResponse.json(updated);
}

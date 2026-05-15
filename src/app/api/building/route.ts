import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, housingRootData } from "@/db/schema";
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
    // Phase 2b dual-write: legacy table + entities.data jsonb.
    await db.insert(housingRootData).values({
      entityId: root.id,
      ...bootstrapValues,
    });
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
  const housingUpdate: Record<string, unknown> = {};
  if (address !== undefined) housingUpdate.address = address;
  if (ico !== undefined) housingUpdate.ico = ico;
  if (votingMethod !== undefined) housingUpdate.votingMethod = votingMethod;
  if (legalNotice !== undefined) housingUpdate.legalNotice = legalNotice;
  if (country !== undefined) housingUpdate.country = country;
  if (governanceModel !== undefined) housingUpdate.governanceModel = governanceModel;
  if (Object.keys(housingUpdate).length > 0) {
    // Phase 2b dual-write: keep housingRootData as the rollback source
    // while making entities.data the read-path truth.
    await db
      .update(housingRootData)
      .set(housingUpdate)
      .where(eq(housingRootData.entityId, existing.id));
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
  }

  const updated = await getCommunityRoot();
  return NextResponse.json(updated);
}

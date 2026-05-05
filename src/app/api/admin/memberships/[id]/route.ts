import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { memberships, membershipRoleEnum } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";

type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
const VALID_ROLES = new Set<MembershipRole>(membershipRoleEnum.enumValues);

async function handlePatch(
  request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const updateData: Partial<typeof memberships.$inferInsert> = {};
  if (typeof body.role === "string" && VALID_ROLES.has(body.role as MembershipRole)) {
    updateData.role = body.role as MembershipRole;
  }
  if (typeof body.weight === "number" && body.weight > 0) {
    updateData.weight = body.weight;
  }
  if (
    body.status === "pending" ||
    body.status === "active" ||
    body.status === "archived"
  ) {
    updateData.status = body.status;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const [before] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [updated] = await db
    .update(memberships)
    .set(updateData)
    .where(eq(memberships.id, id))
    .returning();

  recordEntityAudit({
    action: "membership.update_role",
    actorUserId: null,
    entityId: before.entityId,
    before: { role: before.role, status: before.status, weight: before.weight },
    after: { role: updated.role, status: updated.status, weight: updated.weight },
  });

  return NextResponse.json(updated);
}

async function handleDelete(
  _request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [before] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(memberships).where(eq(memberships.id, id));

  recordEntityAudit({
    action: "membership.remove",
    actorUserId: null,
    entityId: before.entityId,
    before: { role: before.role, userId: before.userId },
  });

  return NextResponse.json({ success: true });
}

export const PATCH = withExternalAuth(handlePatch, "full");
export const DELETE = withExternalAuth(handleDelete, "full");

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { memberships, membershipRoleEnum } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";
import { endMembershipsTx } from "@/lib/ownership.server";
import { todayIso } from "@/lib/ownership";

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
  // 'archived' is reached only by ending the membership (valid_to set,
  // BYT-20261118-007 invariant status='archived' ⇔ valid_to IS NOT NULL).
  const wantsEnd = body.status === "archived";
  if (body.status === "pending" || body.status === "active") {
    updateData.status = body.status;
  }

  if (Object.keys(updateData).length === 0 && !wantsEnd) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const [before] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (before.validTo !== null && updateData.status) {
    return NextResponse.json({ error: "membership has ended" }, { status: 409 });
  }
  if (wantsEnd) {
    await endMembershipsTx(db, [id], { date: todayIso(), reason: "correction", actorUserId: null });
  }
  const [updated] = Object.keys(updateData).length > 0
    ? await db
        .update(memberships)
        .set(updateData)
        .where(eq(memberships.id, id))
        .returning()
    : await db.select().from(memberships).where(eq(memberships.id, id));

  recordEntityAudit({
    action: "membership.update_role",
    actorUserId: null,
    entityId: before.entityId,
    before: { role: before.role, status: before.status, weight: before.weight },
    after: { role: updated.role, status: updated.status, weight: updated.weight },
  });

  return NextResponse.json(updated);
}

// BYT-20261118-007: "delete" ENDS the membership (valid_to = today,
// end_reason 'correction'). The row stays — it is ownership history that
// closed voting results and accounting attribution read.
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

  const today = todayIso();
  await endMembershipsTx(db, [id], { date: today, reason: "correction", actorUserId: null });

  recordEntityAudit({
    action: "membership.end",
    actorUserId: null,
    entityId: before.entityId,
    before: { role: before.role, userId: before.userId, membershipId: id },
    after: { validTo: today, endReason: "correction", source: "external_api" },
  });

  return NextResponse.json({ success: true, ended: true });
}

export const PATCH = withExternalAuth(handlePatch, "full");
export const DELETE = withExternalAuth(handleDelete, "full");

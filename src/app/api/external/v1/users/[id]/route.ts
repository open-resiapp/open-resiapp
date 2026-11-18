import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, memberships, entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";
import { endMembershipsTx } from "@/lib/ownership.server";
import { todayIso } from "@/lib/ownership";
import type { ValidatedApiKey } from "@/lib/api-keys";

async function handleGet(
  _request: NextRequest,
  _apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) {
  const { id } = await context!.params;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Phase 2b: flat_number read from entities.data jsonb.
  const ufRows = await db
    .select({
      flatId: entities.id,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json({
    ...user,
    flats: ufRows,
  });
}

async function handlePatch(
  request: NextRequest,
  _apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) {
  const { id } = await context!.params;
  const body = await request.json();
  const { name, phone, role, isActive, flatIds } = body;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;

  if (Object.keys(updateData).length > 0) {
    await db.update(users).set(updateData).where(eq(users.id, id));
  }

  // BYT-20261118-007: diff-based. The old delete-all + re-insert wiped
  // ownership history and reset every co-owner share to 1/1. Now: units
  // kept keep their row (share, weight, LV facts untouched); units dropped
  // are ENDED (valid_to = today, end_reason 'correction', audited); new units
  // get a 1/1 membership (the API carries no share — set it in the app).
  if (flatIds !== undefined) {
    if (!Array.isArray(flatIds) || flatIds.some((f: unknown) => typeof f !== "string")) {
      return NextResponse.json({ error: "flatIds must be an array of ids" }, { status: 400 });
    }
    const [userRow] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const userRole = userRow?.role as
      | typeof memberships.$inferInsert.role
      | undefined;

    const current = await db
      .select({ id: memberships.id, entityId: memberships.entityId })
      .from(memberships)
      .where(and(eq(memberships.userId, id), isNull(memberships.validTo)));
    const want = new Set<string>(flatIds as string[]);
    const have = new Set(current.map((m) => m.entityId));
    const toEnd = current.filter((m) => !want.has(m.entityId));
    const toAdd = [...want].filter((eid) => !have.has(eid));

    const today = todayIso();
    const ended = await endMembershipsTx(db, toEnd.map((m) => m.id), {
      date: today,
      reason: "correction",
      actorUserId: null,
    });
    for (const m of toEnd.filter((x) => ended.includes(x.id))) {
      recordEntityAudit({
        action: "membership.end",
        actorUserId: null,
        entityId: m.entityId,
        before: { membershipId: m.id, userId: id },
        after: { validTo: today, endReason: "correction", source: "external_api" },
      });
    }
    if (toAdd.length > 0 && userRole) {
      await db.insert(memberships).values(
        toAdd.map((fid) => ({
          userId: id,
          entityId: fid,
          role: userRole,
          status: "active" as const,
        }))
      );
    }
  }

  // Return updated user
  const [updated] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id));

  return NextResponse.json(updated);
}

export const GET = withExternalAuth(handleGet, "read");
export const PATCH = withExternalAuth(handlePatch, "read_write");

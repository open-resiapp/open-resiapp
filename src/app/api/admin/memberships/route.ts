import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { memberships, membershipRoleEnum } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";

type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
const VALID_ROLES = new Set<MembershipRole>(membershipRoleEnum.enumValues);

async function handler(request: NextRequest, _apiKey: unknown) {
  const body = await request.json();
  const { userId, entityId, role = "owner", weight, status = "active" } = body ?? {};

  if (typeof userId !== "string" || typeof entityId !== "string") {
    return NextResponse.json(
      { error: "userId and entityId are required" },
      { status: 400 }
    );
  }
  if (!VALID_ROLES.has(role as MembershipRole)) {
    return NextResponse.json(
      { error: `role must be one of: ${[...VALID_ROLES].join(", ")}` },
      { status: 400 }
    );
  }

  // An ended ownership is recorded by ending a current one (DELETE /
  // PATCH status 'archived'), never inserted directly (BYT-20261118-007).
  if (status === "archived") {
    return NextResponse.json({ error: "status 'archived' cannot be created" }, { status: 400 });
  }

  const [created] = await db
    .insert(memberships)
    .values({
      userId,
      entityId,
      role: role as MembershipRole,
      weight: typeof weight === "number" && weight > 0 ? weight : 1,
      status:
        status === "pending" || status === "active" || status === "archived"
          ? status
          : "active",
    })
    .onConflictDoUpdate({
      // Partial unique index (BYT-20261118-007): one CURRENT row per
      // (user, unit); ended periods never conflict.
      target: [memberships.userId, memberships.entityId],
      targetWhere: sql`${memberships.validTo} IS NULL`,
      set: {
        role: role as MembershipRole,
        status:
          status === "pending" || status === "active" || status === "archived"
            ? status
            : "active",
        ...(typeof weight === "number" && weight > 0 ? { weight } : {}),
      },
    })
    .returning();

  recordEntityAudit({
    action: "membership.create",
    actorUserId: null,
    entityId,
    after: { membershipId: created.id, userId, role: created.role },
  });

  return NextResponse.json(created, { status: 201 });
}

export const POST = withExternalAuth(handler, "full");

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  users,
  memberships,
  entities,
} from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { endMembershipsTx } from "@/lib/ownership.server";
import { todayIso } from "@/lib/ownership";
import { recordEntityAudit } from "@/lib/entity-audit";
import { hardDeleteUser, planHardDelete } from "@/lib/user-merge.server";
import { listUserFlats } from "@/lib/legacy-compat";
import { hasPermission } from "@/lib/permissions";
import {
  rational,
  mul,
  add,
  isOne,
  type Rational,
} from "@/lib/rational";
import type { UserRole } from "@/types";

// Mirror the import seeder (src/lib/import/seed.ts): membership.weight is the
// owner's share of the whole community (unitShare × ownerUnitShare) scaled to
// an integer. Recomputed here whenever an owner's unit share is edited so
// voting math stays consistent with the import path.
const WEIGHT_SCALE = 1_000_000n;

function computeWeight(
  unit: { num: number; den: number } | undefined,
  ownerNum: number,
  ownerDen: number
): number {
  // No unit share on record (legacy/shell unit) — fall back to a 1/1 unit
  // share so weight = ownerShare × scale, never silently zero.
  const unitShare = unit ? rational(unit.num, unit.den) : rational(1, 1);
  const w = mul(unitShare, rational(ownerNum, ownerDen));
  return Number((w.num * WEIGHT_SCALE) / w.den);
}

// Soft-warn helper: for the given unit ids, sum each unit's active owner_unit
// shares and report any whose sum ≠ 1/1. Non-blocking — surfaced to the UI so
// an admin mid-editing co-owners knows the unit is temporarily inconsistent.
async function computeShareWarnings(unitIds: string[]) {
  if (unitIds.length === 0) return [];
  const rows = await db
    .select({
      unitId: memberships.entityId,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        inArray(memberships.entityId, unitIds),
        eq(memberships.status, "active")
      )
    );

  const byUnit = new Map<string, { flatNumber: string; acc: Rational }>();
  for (const r of rows) {
    const term = rational(r.num, r.den);
    const cur = byUnit.get(r.unitId);
    if (!cur) byUnit.set(r.unitId, { flatNumber: r.flatNumber, acc: term });
    else cur.acc = add(cur.acc, term);
  }

  const warnings: Array<{
    flatId: string;
    flatNumber: string;
    sumNumerator: string;
    sumDenominator: string;
  }> = [];
  for (const [unitId, slot] of byUnit) {
    if (!isOne(slot.acc)) {
      warnings.push({
        flatId: unitId,
        flatNumber: slot.flatNumber,
        sumNumerator: slot.acc.num.toString(),
        sumDenominator: slot.acc.den.toString(),
      });
    }
  }
  return warnings;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      passwordHash: users.passwordHash,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  const isShell = user.passwordHash === null;

  // Phase 9.1c: read user's flats via memberships → housing_unit
  // entities → housing_unit_data + parent (entrance) entity.
  const userFlatRows = await listUserFlats(id);

  // Backward-compat: single flat fields from first flat
  const firstFlat = userFlatRows[0] || null;

  // passwordHash is internal — strip before returning.
  const { passwordHash: _ignored, ...safeUser } = user;
  void _ignored;

  return NextResponse.json({
    ...safeUser,
    isShell,
    flats: userFlatRows,
    // Backward-compat fields
    flatNumber: firstFlat?.flatNumber || null,
    floor: firstFlat?.floor ?? null,
    entranceId: firstFlat?.entranceId || null,
    entranceName: firstFlat?.entranceName || null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  // Owner share per flat — memberships.owner_unit_share_*. Optional array,
  // keyed by flatId. Each share is a positive integer fraction.
  const shareByFlat = new Map<string, { num: number; den: number }>();
  if (Array.isArray(body.shares)) {
    for (const s of body.shares) {
      if (
        !s ||
        typeof s.flatId !== "string" ||
        !Number.isInteger(s.num) ||
        !Number.isInteger(s.den) ||
        s.num <= 0 ||
        s.den <= 0
      ) {
        return NextResponse.json(
          { error: "Neplatný vlastnícky podiel" },
          { status: 400 }
        );
      }
      shareByFlat.set(s.flatId, { num: s.num, den: s.den });
    }
  }

  // Collected for the soft-warn share-sum check after mutations apply.
  let affectedUnitIds: string[] = [];

  // Handle flatIds array (new) or flatId (legacy)
  const hasFlatIds = body.flatIds !== undefined;
  const hasFlatId = body.flatId !== undefined;

  if (hasFlatIds || hasFlatId) {
    const resolvedFlatIds: string[] = hasFlatIds
      ? (body.flatIds || [])
      : body.flatId
        ? [body.flatId]
        : [];

    // Phase 9.1d: memberships are the single source of truth.
    // Resolve membership role from the new role (if updating) or the
    // existing user's role.
    const resolvedRole = (updateData.role ??
      (
        await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
      )[0]?.role) as typeof memberships.$inferInsert.role | undefined;

    // Drop existing housing-unit memberships for this user that are
    // not in the new set; insert any missing.
    // BYT-20261118-007: only CURRENT memberships take part; ended periods
    // are history and never touched here.
    const existingMemberships = await db
      .select({
        id: memberships.id,
        entityId: memberships.entityId,
        num: memberships.ownerUnitShareNumerator,
        den: memberships.ownerUnitShareDenominator,
      })
      .from(memberships)
      .where(and(eq(memberships.userId, id), isNull(memberships.validTo)));

    const existingByEntity = new Map(
      existingMemberships.map((m) => [m.entityId, m])
    );
    const wantSet = new Set(resolvedFlatIds);
    const haveSet = new Set(existingMemberships.map((m) => m.entityId));

    const toRemove = [...haveSet].filter((eid) => !wantSet.has(eid));
    const toAdd = [...wantSet].filter((eid) => !haveSet.has(eid));
    const toKeep = [...wantSet].filter((eid) => haveSet.has(eid));

    // Unit-of-community shares for weight derivation, fetched once for all
    // wanted flats.
    const unitShareById = new Map<string, { num: number; den: number }>();
    if (resolvedFlatIds.length > 0) {
      const unitRows = await db
        .select({
          id: entities.id,
          num: sql<number>`(${entities.data}->>'share_numerator')::int`,
          den: sql<number>`(${entities.data}->>'share_denominator')::int`,
        })
        .from(entities)
        .where(inArray(entities.id, resolvedFlatIds));
      for (const u of unitRows) {
        if (u.num != null && u.den != null && u.den !== 0) {
          unitShareById.set(u.id, { num: u.num, den: u.den });
        }
      }
    }

    if (toRemove.length > 0) {
      // BYT-20261118-007: a unit dropped from the list ENDS the ownership
      // (valid_to = today, end_reason 'correction'); the row and its history
      // stay. A sale goes through the transfer flow instead.
      const removeIds = existingMemberships
        .filter((m) => toRemove.includes(m.entityId))
        .map((m) => m.id);
      const today = todayIso();
      const ended = await endMembershipsTx(db, removeIds, {
        date: today,
        reason: "correction",
        actorUserId: session.user.id,
      });
      for (const m of existingMemberships.filter((x) => ended.includes(x.id))) {
        recordEntityAudit({
          action: "membership.end",
          actorUserId: session.user.id,
          entityId: m.entityId,
          before: { membershipId: m.id, userId: id, share: `${m.num}/${m.den}` },
          after: { validTo: today, endReason: "correction", source: "users.patch" },
        });
      }
    }

    if (toAdd.length > 0 && resolvedRole) {
      for (const eid of toAdd) {
        const share = shareByFlat.get(eid) ?? { num: 1, den: 1 };
        const weight = computeWeight(
          unitShareById.get(eid),
          share.num,
          share.den
        );
        await db.insert(memberships).values({
          userId: id,
          entityId: eid,
          role: resolvedRole,
          weight,
          ownerUnitShareNumerator: share.num,
          ownerUnitShareDenominator: share.den,
          status: "active" as const,
        });
      }
    }

    // Update share (and derived weight) on kept memberships when a new share
    // was supplied and differs from what's stored.
    for (const eid of toKeep) {
      const share = shareByFlat.get(eid);
      if (!share) continue;
      const cur = existingByEntity.get(eid);
      if (cur && cur.num === share.num && cur.den === share.den) continue;
      const weight = computeWeight(
        unitShareById.get(eid),
        share.num,
        share.den
      );
      await db
        .update(memberships)
        .set({
          ownerUnitShareNumerator: share.num,
          ownerUnitShareDenominator: share.den,
          weight,
        })
        .where(
          and(
            eq(memberships.userId, id),
            eq(memberships.entityId, eid),
            isNull(memberships.validTo)
          )
        );
    }

    // A removed owner changes its old unit's sum too — include both sides.
    affectedUnitIds = [...new Set([...resolvedFlatIds, ...toRemove])];
  }

  if (Object.keys(updateData).length === 0 && !hasFlatIds && !hasFlatId) {
    return NextResponse.json({ error: "Žiadne údaje na aktualizáciu" }, { status: 400 });
  }

  // Check email uniqueness if changing email
  if (updateData.email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, updateData.email as string))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== id) {
      return NextResponse.json(
        { error: "Používateľ s týmto emailom už existuje" },
        { status: 400 }
      );
    }
  }

  let updated;
  if (Object.keys(updateData).length > 0) {
    [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
      });
  } else {
    // Only flatIds changed, fetch user data
    [updated] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
  }

  if (!updated) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  const shareWarnings = await computeShareWarnings(affectedUnitIds);

  return NextResponse.json({ ...updated, shareWarnings });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  // Prevent self-deletion
  if (session.user.id === id) {
    return NextResponse.json(
      { error: "Nemôžete zmazať vlastný účet" },
      { status: 400 }
    );
  }

  // BYT-20261118-007: driven by the user-FK registry (planHardDelete). Any
  // retained history → 409 user_has_history with the plan (counts), never a
  // 500 and never a cascade over history. The caller confirms the plan hash
  // it showed (`?planHash=`); without it (or stale) → 409 plan_stale + plan.
  const planHash = _request.nextUrl.searchParams.get("planHash") ?? "";
  if (!planHash) {
    const planned = await planHardDelete(id, session.user.id);
    if (!planned.ok) {
      return NextResponse.json({ error: planned.error }, { status: planned.error === "not_found" ? 404 : 409 });
    }
    const blocked = planned.plan.blockers.length > 0;
    return NextResponse.json(
      { error: blocked ? "user_has_history" : "plan_stale", plan: planned.plan },
      { status: 409 }
    );
  }
  const res = await hardDeleteUser(id, session.user.id, planHash);
  if (!res.ok) {
    const status = res.error === "not_found" ? 404 : res.error === "failed" ? 500 : 409;
    return NextResponse.json({ error: res.error, plan: res.plan }, { status });
  }
  return NextResponse.json({ success: true });
}

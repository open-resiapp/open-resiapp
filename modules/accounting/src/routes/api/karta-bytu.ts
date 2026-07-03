import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { db } from "@/db";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import {
  applyUnitCredit,
  canReadUnitLedger,
  getUnitLedger,
  listAccessibleUnits,
  listUnitBalances,
} from "@modules/accounting/src/lib/karta-bytu";
import { postAllDueMonths } from "@modules/accounting/src/lib/fee-schedule-publish";

// Karta bytu API. Unlike the treasurer-only routes, owners are allowed
// here — scoped server-side to units they hold an active owner membership
// on (403 otherwise, never just a hidden button).

import type { Session } from "next-auth";
import type { CommunityRootRow } from "@/lib/legacy-compat";

type BaseCtx =
  | { error: NextResponse; session?: never; root?: never }
  | { error?: never; session: Session; root: CommunityRootRow };

async function baseCtx(): Promise<BaseCtx> {
  const session = await auth();
  if (!session) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const root = await getCommunityRoot();
  if (!root) {
    return {
      error: NextResponse.json({ error: "no community" }, { status: 404 }),
    };
  }
  return { session, root };
}

/** GET /api/accounting/karta — accessible units with balances. */
export async function handleListUnits(): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  const isWriter = await canWriteAccounting(
    session.user.id,
    session.user.role as string,
    root.id
  );
  // Due months post lazily on EVERY karta read — an owner's balance must
  // never lag behind the calendar (invariant 7: complete flows). The
  // triggering user is recorded as the posting actor; the entries
  // themselves are schedule-sourced and idempotent.
  await db.transaction((tx) =>
    postAllDueMonths(tx, {
      entityId: root.id,
      country: root.country,
      actorId: session.user.id,
    })
  );

  const units = await listAccessibleUnits(
    session.user.id,
    session.user.role as string,
    root.id
  );
  const balances = await listUnitBalances(
    root.id,
    root.country,
    units.map((u) => u.id)
  );
  return NextResponse.json({
    units: units.map((u) => ({
      ...u,
      balanceCents: balances.get(u.id) ?? 0,
    })),
    canWrite: isWriter,
  });
}

/** GET /api/accounting/karta/[unitId] — the unit's ledger. */
export async function handleGetLedger(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  const allowed = await canReadUnitLedger(
    session.user.id,
    session.user.role as string,
    root.id,
    unitEntityId
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const isWriter = await canWriteAccounting(
    session.user.id,
    session.user.role as string,
    root.id
  );
  await db.transaction((tx) =>
    postAllDueMonths(tx, {
      entityId: root.id,
      country: root.country,
      actorId: session.user.id,
    })
  );

  const ledger = await getUnitLedger(root.id, unitEntityId, root.country);
  if (!ledger) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ledger, canWrite: isWriter });
}

/** POST /api/accounting/karta/[unitId]/apply-credit — treasurer/admin. */
export async function handleApplyCredit(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  const isWriter = await canWriteAccounting(
    session.user.id,
    session.user.role as string,
    root.id
  );
  if (!isWriter) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await applyUnitCredit({
      entityId: root.id,
      country: root.country,
      unitEntityId,
      actorId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "apply failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

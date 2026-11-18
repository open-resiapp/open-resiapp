import { NextRequest, NextResponse } from "next/server";

import { sessionAccountingCtx } from "@modules/accounting/src/lib/accounting-ctx";
import { db } from "@/db";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import {
  applyUnitCredit,
  getUnitLedger,
  getUnitReadScope,
  listAccessibleUnitScopes,
  listScopedUnitBalances,
  scopeLedger,
} from "@modules/accounting/src/lib/karta-bytu";
import { yearInScope } from "@modules/accounting/src/lib/ownership-windows";
import { postAllDueMonths } from "@modules/accounting/src/lib/fee-schedule-publish";
import { getPredpisPdfData } from "@modules/accounting/src/lib/predpis-pdf-data";
import {
  getVyuctovaniePdfData,
  listSettlementYearsForUnit,
} from "@modules/accounting/src/lib/vyuctovanie";
import {
  getOverdueForUnit,
  getUpomienkaPdfData,
  scopeOverdue,
} from "@modules/accounting/src/lib/overdue";

// Karta bytu API. Unlike the treasurer-only routes, owners are allowed
// here — scoped server-side by getUnitReadScope (403 otherwise, never just
// a hidden button): board readers see the whole history, an owner only
// the postings / overdue months / settlement years of their OWN ownership
// windows (a buyer never sees the seller's history — BYT-20261118-012).

/** GET /api/accounting/karta — accessible units with balances. */
export async function handleListUnits(): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const isWriter = await canWriteAccounting(
    principal.userId,
    principal.role,
    root.id
  );
  const units = await listAccessibleUnitScopes(
    principal.userId,
    principal.role,
    root.id
  );
  // Due months post lazily on karta reads — an owner's balance must never
  // lag behind the calendar (invariant 7). Only for users with actual
  // accounting access, though: a session with zero accessible units must
  // not be able to trigger ledger writes by hammering this GET.
  if (isWriter || units.length > 0) {
    await db.transaction((tx) =>
      postAllDueMonths(tx, {
        entityId: root.id,
        country: root.country,
      })
    );
  }

  const balances = await listScopedUnitBalances(root.id, root.country, units);
  return NextResponse.json({
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      flatNumber: u.flatNumber,
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
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const scope = await getUnitReadScope(
    principal.userId,
    principal.role,
    root.id,
    unitEntityId
  );
  if (!scope) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const isWriter = await canWriteAccounting(
    principal.userId,
    principal.role,
    root.id
  );
  await db.transaction((tx) =>
    postAllDueMonths(tx, {
      entityId: root.id,
      country: root.country,
    })
  );

  const full = await getUnitLedger(root.id, unitEntityId, root.country);
  if (!full) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ledger = scopeLedger(full, scope.windows);
  const settlementYears = (
    await listSettlementYearsForUnit(root.id, unitEntityId)
  ).filter((y) => yearInScope(y, scope.windows));
  return NextResponse.json({ ledger, canWrite: isWriter, settlementYears });
}

/** GET /api/accounting/karta/[unitId]/overdue — read-only interest calc. */
export async function handleOverdue(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const scope = await getUnitReadScope(
    principal.userId,
    principal.role,
    root.id,
    unitEntityId
  );
  if (!scope) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const summary = await getOverdueForUnit({
    entityId: root.id,
    country: root.country,
    unitEntityId,
  });
  return NextResponse.json(scopeOverdue(summary, scope.windows));
}

/**
 * GET /api/accounting/karta/[unitId]/upomienka-pdf — dunning-letter data.
 * WRITER only: the upomienka is a treasurer artifact sent TO the owner,
 * not an owner self-service download.
 */
export async function handleUpomienkaPdfData(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const isWriter = await canWriteAccounting(
    principal.userId,
    principal.role,
    root.id
  );
  if (!isWriter) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await getUpomienkaPdfData({
      entityId: root.id,
      country: root.country,
      unitEntityId,
      beneficiaryName: root.name,
    });
    return NextResponse.json({
      ...data,
      building: { name: root.name, address: root.address, ico: root.ico, dic: root.dic },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pdf data failed";
    const status = message.includes("nothing overdue") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/** GET /api/accounting/karta/[unitId]/vyuctovanie-pdf?year= */
export async function handleVyuctovaniePdfData(
  req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const scope = await getUnitReadScope(
    principal.userId,
    principal.role,
    root.id,
    unitEntityId
  );
  if (!scope) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  // A settlement year outside the owner's own period is someone else's
  // statement — same answer as a missing one.
  if (!yearInScope(year, scope.windows)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const data = await getVyuctovaniePdfData({
      entityId: root.id,
      country: root.country,
      unitEntityId,
      year,
      beneficiaryName: root.name,
    });
    return NextResponse.json({
      ...data,
      building: { name: root.name, address: root.address, ico: root.ico, dic: root.dic },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pdf data failed";
    const status = message.includes("no published") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/** GET /api/accounting/karta/[unitId]/predpis-pdf — data for the PDF. */
export async function handlePredpisPdfData(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const scope = await getUnitReadScope(
    principal.userId,
    principal.role,
    root.id,
    unitEntityId
  );
  // The monthly predpis is the CURRENT owner's payment instruction; a
  // former owner keeps their history but not the new owner's predpis.
  if (!scope || !scope.current) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await getPredpisPdfData({
      entityId: root.id,
      country: root.country,
      unitEntityId,
      beneficiaryName: root.name,
    });
    return NextResponse.json({
      ...data,
      building: { name: root.name, address: root.address, ico: root.ico, dic: root.dic },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pdf data failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST /api/accounting/karta/[unitId]/apply-credit — treasurer/admin. */
export async function handleApplyCredit(
  _req: NextRequest,
  unitEntityId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const isWriter = await canWriteAccounting(
    principal.userId,
    principal.role,
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
      actorId: principal.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "apply failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

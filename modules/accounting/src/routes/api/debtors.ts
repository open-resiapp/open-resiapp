import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { entities, memberships } from "@/db/schema";
import { domUnitsWhere } from "@modules/accounting/src/lib/dom-units";
import { getDebtorList } from "@modules/accounting/src/lib/debtors";

// Debtor list — visible to any OWNER of the dom (whole-dom transparency),
// but only when the treasurer has set a disclosure threshold.
export async function handleGet(): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const root = await getCommunityRoot();
  if (!root) return NextResponse.json({ error: "no community" }, { status: 404 });

  const userRole = session.user.role as string;
  let member = userRole === "admin";
  if (!member) {
    const [row] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(entities, eq(memberships.entityId, entities.id))
      .where(
        and(
          eq(memberships.userId, session.user.id),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
          domUnitsWhere(root.id)
        )
      )
      .limit(1);
    member = !!row;
  }
  if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const list = await getDebtorList(root.id, root.country);
  return NextResponse.json(list);
}

import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";

// "Live unit of this dom" is the module's tenancy boundary — every screen
// that lists or validates units goes through here so the predicate can't
// fork (archived or foreign units must never receive VS, balances or
// assessments).

/** Drizzle condition selecting live units of the dom. */
export function domUnitsWhere(rootEntityId: string) {
  return and(
    eq(entities.kind, "unit"),
    eq(entities.rootId, rootEntityId),
    isNull(entities.archivedAt)
  );
}

export interface DomUnit {
  id: string;
  name: string;
  flatNumber: string | null;
}

export async function listDomUnits(rootEntityId: string): Promise<DomUnit[]> {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
    })
    .from(entities)
    .where(domUnitsWhere(rootEntityId))
    .orderBy(asc(entities.name));
}

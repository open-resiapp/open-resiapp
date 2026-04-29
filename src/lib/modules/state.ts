import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coreModules } from "@/db/schema";

export async function markModuleFailed(
  name: string,
  err: unknown
): Promise<void> {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  await db
    .update(coreModules)
    .set({
      status: "failed",
      lastFailureAt: new Date(),
      lastFailureMessage: message.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(coreModules.name, name));
}

export async function incrementFailureCount(name: string): Promise<void> {
  const [row] = await db
    .select({ failureCount: coreModules.failureCount })
    .from(coreModules)
    .where(eq(coreModules.name, name))
    .limit(1);
  if (!row) return;
  await db
    .update(coreModules)
    .set({ failureCount: row.failureCount + 1, updatedAt: new Date() })
    .where(eq(coreModules.name, name));
}

export async function resetFailureCount(name: string): Promise<void> {
  await db
    .update(coreModules)
    .set({ failureCount: 0, updatedAt: new Date() })
    .where(eq(coreModules.name, name));
}

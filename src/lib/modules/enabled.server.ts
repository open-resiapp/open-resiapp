import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coreModules } from "@/db/schema";

/** Names of modules with core_modules.status = 'enabled'. */
export async function listEnabledModuleNames(): Promise<string[]> {
  const rows = await db
    .select({ name: coreModules.name })
    .from(coreModules)
    .where(eq(coreModules.status, "enabled"));
  return rows.map((r) => r.name);
}

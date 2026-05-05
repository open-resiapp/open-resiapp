import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coreModules } from "@/db/schema";

// In-process cache so every request doesn't re-query core_modules.
// Invalidated on every install/uninstall via clearModuleStatusCache().
let cache: Map<string, "enabled" | "disabled" | "failed" | "absent"> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadCache() {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;
  const rows = await db
    .select({ name: coreModules.name, status: coreModules.status })
    .from(coreModules);
  cache = new Map(rows.map((r) => [r.name, r.status]));
  cacheLoadedAt = Date.now();
  return cache;
}

export function clearModuleStatusCache(): void {
  cache = null;
}

/**
 * Returns true if the module exists in `core_modules` and has
 * status='enabled'. Returns false otherwise (disabled, failed, or
 * never-installed).
 */
export async function isModuleEnabled(name: string): Promise<boolean> {
  const map = await loadCache();
  return map.get(name) === "enabled";
}

/**
 * Wraps a Next.js route handler so it returns 404 when the named
 * module is disabled or absent. Use on every module-owned route entry
 * (server / API). Lets a tenant disable a bundled module via DB without
 * having to delete files or rewrite routes.
 *
 *   export const GET = withModuleEnabled("voting", handlerImpl);
 */
export function withModuleEnabled<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends (...args: any[]) => Promise<NextResponse> | NextResponse
>(moduleName: string, handler: H): H {
  return (async (...args: Parameters<H>) => {
    if (!(await isModuleEnabled(moduleName))) {
      return NextResponse.json(
        { error: `Module "${moduleName}" is not enabled for this tenant` },
        { status: 404 }
      );
    }
    return handler(...args);
  }) as H;
}

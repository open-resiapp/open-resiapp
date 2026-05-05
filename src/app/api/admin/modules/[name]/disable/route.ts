import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coreModules } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { clearModuleStatusCache } from "@/lib/modules/route-guard";

async function handler(
  _request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const name = params.name;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const [row] = await db
    .select({ name: coreModules.name })
    .from(coreModules)
    .where(eq(coreModules.name, name))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { error: `module "${name}" is not installed` },
      { status: 404 }
    );
  }

  await db
    .update(coreModules)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(coreModules.name, name));
  clearModuleStatusCache();

  // Note: data is preserved. Voting (and any other bundled module
  // with retention rules) refuses uninstall, but disable is always
  // safe to undo via /api/admin/modules/{name}/enable.
  return NextResponse.json({ success: true, name, status: "disabled" });
}

export const POST = withExternalAuth(handler, "full");

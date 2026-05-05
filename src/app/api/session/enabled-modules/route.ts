import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { coreModules } from "@/db/schema";

// Lightweight endpoint the Sidebar (and any other client UI) hits to
// learn which modules are currently enabled. Lets nav items flagged
// `requiresModule` hide themselves when the operator disabled the
// module in /settings/modules.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const rows = await db
    .select({ name: coreModules.name })
    .from(coreModules)
    .where(eq(coreModules.status, "enabled"));
  return NextResponse.json(rows.map((r) => r.name));
}

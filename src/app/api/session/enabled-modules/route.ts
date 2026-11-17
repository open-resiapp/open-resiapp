import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { listEnabledModuleNames } from "@/lib/modules/enabled.server";

// Lightweight endpoint for client UI that needs the enabled-module set.
// The dashboard shell no longer calls it — the server layout resolves the
// same list once (ShellData.enabledModules).
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  return NextResponse.json(await listEnabledModuleNames());
}

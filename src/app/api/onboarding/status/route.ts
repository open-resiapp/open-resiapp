import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getOnboardingStatus } from "@/lib/onboarding.server";
import type { UserRole } from "@/types";

// RES-20260609-001: single signal consumed by the /onboarding wizard
// ("which steps are done?"). The dashboard banner reads the same data
// through the server layout (ShellData). Logic lives in
// src/lib/onboarding.server.ts.
//
// Admin/chairman surface only: the banner and wizard never render for
// owners, so the endpoint mirrors that with a manageSettings gate.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  return NextResponse.json(await getOnboardingStatus());
}

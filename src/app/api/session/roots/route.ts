import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { listCurrentEntityOptions } from "@/lib/current-entity";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const roots = await listCurrentEntityOptions(session.user.id);
  return NextResponse.json(roots);
}

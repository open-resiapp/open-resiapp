import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { resolveCurrentEntityId } from "@/lib/current-entity";
import {
  listClaimableRealUsers,
  listPendingShellUsers,
} from "@/lib/invitations";
import { rankCandidates } from "@/lib/name-match";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rootId = await resolveCurrentEntityId(session.user.id);
  const shells = rootId ? await listPendingShellUsers(rootId) : [];
  const registrants = await listClaimableRealUsers();

  // Pre-compute name-similarity matches per registrant against the
  // unclaimed shell pool. UI surfaces the top one with its score.
  const candidatePool = shells.map((s) => ({ id: s.id, name: s.name }));
  const enriched = registrants.map((r) => {
    const ranked = rankCandidates(r.name, candidatePool, 0.5);
    return {
      ...r,
      createdAt: r.createdAt.toISOString(),
      suggestions: ranked.slice(0, 3).map((c) => {
        const shell = shells.find((s) => s.id === c.candidate.id)!;
        return {
          shellId: shell.id,
          shellName: shell.name,
          flatNumber: shell.flatNumber,
          score: c.score,
        };
      }),
    };
  });

  return NextResponse.json({
    registrants: enriched,
    shells: shells.map((s) => ({
      id: s.id,
      name: s.name,
      flatNumber: s.flatNumber,
    })),
  });
}

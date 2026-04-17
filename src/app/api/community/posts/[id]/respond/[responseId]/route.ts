import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { communityResponses } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "moderateCommunityResponse")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id, responseId } = await params;
  await db
    .delete(communityResponses)
    .where(
      and(
        eq(communityResponses.id, responseId),
        eq(communityResponses.postId, id)
      )
    );

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { approvePendingRegistration } from "@/lib/registration-review.server";
import type { UserRole } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: "Neautorizovaný prístup" },
      { status: 401 }
    );
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { flatId, role = "owner" } = body ?? {};

  // Flat is optional: an admin may admit a registrant into the community
  // without assigning a flat. No flat → activate the user, create no
  // membership (a flatless community member, status='active').
  const hasFlat = typeof flatId === "string" && flatId.length > 0;

  const result = await approvePendingRegistration({
    userId: id,
    flatId: hasFlat ? flatId : null,
    role,
  });

  if (!result.ok) {
    if (result.error === "invalid_role") {
      return NextResponse.json({ error: "Neplatná rola" }, { status: 400 });
    }
    if (result.error === "not_found") {
      return NextResponse.json(
        { error: "Žiadosť nebola nájdená" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: "Byt nebol nájdený" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

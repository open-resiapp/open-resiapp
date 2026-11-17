import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rejectPendingRegistration } from "@/lib/registration-review.server";
import type { UserRole } from "@/types";

export async function POST(
  _request: Request,
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

  if (!(await rejectPendingRegistration(id))) {
    return NextResponse.json(
      { error: "Žiadosť nebola nájdená" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}

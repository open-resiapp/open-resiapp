import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import {
  buildRegistrationUrl,
  disableRegistrationToken,
  generateRegistrationToken,
  getActiveRegistrationToken,
} from "@/lib/registration";
import { routing } from "@/i18n/routing";

async function requireAdmin() {
  const session = await auth();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Neautorizovaný prístup" },
        { status: 401 }
      ),
    };
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Nemáte oprávnenie" },
        { status: 403 }
      ),
    };
  }
  return { session, response: null };
}

export async function GET() {
  const { session, response } = await requireAdmin();
  if (response) return response;
  if (!session) return NextResponse.json({ error: "auth" }, { status: 401 });

  const token = await getActiveRegistrationToken();
  if (!token) {
    return NextResponse.json({ active: null });
  }

  return NextResponse.json({
    active: {
      id: token.id,
      token: token.token,
      url: buildRegistrationUrl(token.token, routing.defaultLocale),
      createdAt: token.createdAt,
    },
  });
}

export async function POST() {
  const { session, response } = await requireAdmin();
  if (response) return response;
  if (!session) return NextResponse.json({ error: "auth" }, { status: 401 });

  const token = await generateRegistrationToken(session.user.id);
  return NextResponse.json(
    {
      id: token.id,
      token: token.token,
      url: buildRegistrationUrl(token.token, routing.defaultLocale),
      createdAt: token.createdAt,
    },
    { status: 201 }
  );
}

export async function DELETE() {
  const { session, response } = await requireAdmin();
  if (response) return response;
  if (!session) return NextResponse.json({ error: "auth" }, { status: 401 });

  await disableRegistrationToken();
  return NextResponse.json({ success: true });
}

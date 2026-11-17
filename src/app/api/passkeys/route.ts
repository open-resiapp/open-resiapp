// BYT-20261117-002 Phase 6: the signed-in user's passkeys.
//   GET    → { passkeys: PasskeySummary[] }
//   DELETE ?id=<row id> → removes one of the caller's own passkeys
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deletePasskey, listPasskeys } from "@/lib/webauthn.server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json({ passkeys: await listPasskeys(session.user.id) });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const ok = await deletePasskey(session.user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "PASSKEY_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

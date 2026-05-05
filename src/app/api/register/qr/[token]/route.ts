import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { registrationTokens } from "@/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [row] = await db
    .select({ id: registrationTokens.id, isActive: registrationTokens.isActive })
    .from(registrationTokens)
    .where(eq(registrationTokens.token, token))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { valid: false, reason: "not_found" },
      { status: 404 }
    );
  }
  if (!row.isActive) {
    return NextResponse.json(
      { valid: false, reason: "disabled" },
      { status: 410 }
    );
  }
  return NextResponse.json({ valid: true });
}

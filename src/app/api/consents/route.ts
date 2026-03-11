import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { consentRecords, users } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const records = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, session.user.id))
    .orderBy(desc(consentRecords.createdAt));

  // Find latest record per consent type
  const latestByType: Record<string, typeof records[0]> = {};
  for (const record of records) {
    if (!latestByType[record.consentType]) {
      latestByType[record.consentType] = record;
    }
  }

  const dataProcessing = latestByType["data_processing"];
  const hasValidDataProcessing =
    dataProcessing?.action === "granted" &&
    dataProcessing.policyVersion === CURRENT_POLICY_VERSION;

  return NextResponse.json({
    consents: latestByType,
    currentPolicyVersion: CURRENT_POLICY_VERSION,
    needsConsent: !hasValidDataProcessing,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { consentType, action } = body;

  if (!["data_processing", "communication"].includes(consentType)) {
    return NextResponse.json({ error: "Neplatný typ súhlasu" }, { status: 400 });
  }

  if (!["granted", "withdrawn"].includes(action)) {
    return NextResponse.json({ error: "Neplatná akcia" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");

  await db.insert(consentRecords).values({
    userId: session.user.id,
    consentType,
    action,
    policyVersion: CURRENT_POLICY_VERSION,
    ipAddress: ip?.split(",")[0]?.trim() || null,
    userAgent,
  });

  // If withdrawing data_processing consent, deactivate the user
  if (consentType === "data_processing" && action === "withdrawn") {
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, session.user.id));
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

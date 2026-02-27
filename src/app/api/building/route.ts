import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { building } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const [result] = await db.select().from(building).limit(1);

  if (!result) {
    return NextResponse.json(null);
  }

  return NextResponse.json(result);
}

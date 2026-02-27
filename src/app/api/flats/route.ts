import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { flats, entrances } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const result = await db
    .select({
      id: flats.id,
      flatNumber: flats.flatNumber,
      floor: flats.floor,
      entranceName: entrances.name,
    })
    .from(flats)
    .leftJoin(entrances, eq(flats.entranceId, entrances.id));

  return NextResponse.json(result);
}

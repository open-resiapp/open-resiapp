import { NextResponse } from "next/server";

// Runtime endpoint for the VAPID public key. Avoids baking the key
// into the JS bundle at build time so the same image can be deployed
// to multiple tenants with their own VAPID pairs (cloud) or rotated
// in-place without a rebuild.
//
// The key is public — safe to expose without auth — but we still
// gate by HTTP method to keep the surface tight.
export async function GET() {
  const key =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Push notifications not configured for this tenant" },
      { status: 503 }
    );
  }
  return NextResponse.json({ publicKey: key });
}

import "server-only";

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { entities, housingRootData, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Identity export endpoint (BYT-20260513-003 — mirror of import).
 *
 * Cloud platform calls this on the sandbox during the "Go Live" promotion to
 * harvest the customer's existing users + minimal org config, then POSTs the
 * same payload to /api/internal/import-identity on the freshly-provisioned
 * production instance.
 *
 * Security model mirrors the import side:
 *   - Bearer token compared in constant time against `PLATFORM_IMPORT_TOKEN`
 *     (per-instance secret, never platform-shared).
 *   - Self-hosted defence: 503 when `PLATFORM_IMPORT_TOKEN` is unset.
 *   - Bcrypt hashes are returned verbatim — the response MUST stay within
 *     cloud's internal network. Token presence is the gate.
 *   - No 409-style restriction (read is idempotent).
 */
export async function GET(req: Request) {
  const expected = process.env.PLATFORM_IMPORT_TOKEN;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      {
        error: "import_disabled",
        message: "Instance is not configured as a cloud import target.",
      },
      { status: 503 }
    );
  }

  const authz = req.headers.get("authorization") ?? "";
  const match = authz.match(/^Bearer\s+(.+)$/i);
  if (!match || !timingSafeEqual(match[1].trim(), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [community] = await db
    .select({
      id: entities.id,
      name: entities.name,
      address: housingRootData.address,
      ico: housingRootData.ico,
      country: housingRootData.country,
      votingMethod: housingRootData.votingMethod,
    })
    .from(entities)
    .innerJoin(housingRootData, eq(housingRootData.entityId, entities.id))
    .where(
      and(eq(entities.kind, "housing_community"), isNull(entities.archivedAt))
    )
    .limit(1);

  if (!community) {
    return NextResponse.json({ error: "no_community" }, { status: 404 });
  }

  const userRows = await db
    .select({
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      role: users.role,
      phone: users.phone,
    })
    .from(users);

  const exportedUsers = userRows
    .filter((u) => u.email && u.passwordHash)
    .map((u) => ({
      email: u.email!,
      name: u.name,
      passwordHash: u.passwordHash!,
      role: u.role,
      phone: u.phone ?? undefined,
    }));

  return NextResponse.json({
    users: exportedUsers,
    org_settings: {
      name: community.name,
      address: community.address,
      ico: community.ico ?? undefined,
      country: community.country,
      votingMethod: community.votingMethod,
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

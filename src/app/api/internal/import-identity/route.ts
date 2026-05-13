import "server-only";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { entities, housingRootData, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Identity import endpoint (BYT-20260513-003).
 *
 * Called by the cloud platform once, during the sandbox → production
 * "Go Live" promotion. Writes the customer's existing user accounts and
 * minimal HOA settings into a freshly-provisioned, empty byt-app instance.
 *
 * Security model:
 *   - Bearer token compared in constant time against `PLATFORM_IMPORT_TOKEN`.
 *     Cloud injects a UNIQUE token per instance at provision — not a shared
 *     platform secret.
 *   - Single-shot: rejects if the `users` table is non-empty. A stolen token
 *     cannot overwrite a live customer's identities post go-live.
 *   - Self-hosted defence: if `PLATFORM_IMPORT_TOKEN` is unset, returns 503.
 *     Self-hosted instances are never valid import targets.
 *   - Bcrypt passthrough: cloud sends existing password hashes verbatim;
 *     this endpoint stores them as-is so users keep their passwords.
 *   - Atomicity: a single DB transaction; partial payloads roll back.
 */

const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  passwordHash: z.string().min(20), // bcrypt $2[aby]$... is ~60 chars; lower bound permissive
  role: z
    .enum(["admin", "owner", "tenant", "vote_counter", "caretaker"])
    .default("owner"),
  phone: z.string().optional(),
});

const orgSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  ico: z.string().optional(),
  country: z.enum(["sk", "cz"]).default("sk"),
  votingMethod: z.enum(["per_share", "per_flat", "per_area"]).default("per_share"),
});

const payloadSchema = z.object({
  users: z.array(userSchema).min(1),
  org_settings: orgSchema,
});

export async function POST(req: Request) {
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Single-shot guard. Outside the txn so the 409 path stays fast.
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      {
        error: "already_imported",
        message:
          "Instance already has users. Identity import is single-shot — provision a fresh instance.",
      },
      { status: 409 }
    );
  }

  const { users: userPayloads, org_settings } = parsed.data;
  const communityId = crypto.randomUUID();

  const result = await db.transaction(async (tx) => {
    await tx.insert(entities).values({
      id: communityId,
      kind: "housing_community",
      name: org_settings.name,
      path: `/${communityId}`,
      depth: 0,
      rootId: communityId,
    });

    await tx.insert(housingRootData).values({
      entityId: communityId,
      address: org_settings.address,
      ico: org_settings.ico,
      country: org_settings.country,
      votingMethod: org_settings.votingMethod,
    });

    const insertedUsers = await tx
      .insert(users)
      .values(
        userPayloads.map((u) => ({
          email: u.email,
          name: u.name,
          passwordHash: u.passwordHash,
          role: u.role,
          phone: u.phone,
          status: "active" as const,
        }))
      )
      .returning({ id: users.id });

    return { userCount: insertedUsers.length };
  });

  return NextResponse.json({
    ok: true,
    inserted: {
      communityId,
      users: result.userCount,
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

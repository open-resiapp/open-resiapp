import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { getStorage } from "@/lib/storage";
import {
  ACCEPTED_LOGO_MIME,
  MAX_LOGO_SIZE,
  MAX_LOGO_DIM,
  MAX_ICON_SIZE,
  ICON_MIME,
  type BrandingData,
} from "@/lib/branding";
import {
  getBranding,
  getPrimaryRootIdOrThrow,
  setBranding,
  brandingStorageKeys,
  sniffImage,
} from "@/lib/branding.server";

// BYT-20260512-008 — white-label logo + PWA icon.
//
// GET    — does this instance have a logo, and at what version (for cache-bust)?
// POST   — multipart: the original logo + 4 client-generated square PNG icons.
// DELETE — clear branding and remove the stored blobs.
//
// Public READS of the bytes live in /api/branding/asset/[name]; this route is
// the admin-gated management surface.

// Success carries no payload — callers only branch on the error. (Deriving a
// type from `auth`'s return is unsafe: it's overloaded, and ReturnType picks
// the middleware overload, not Session.)
type Gate = { ok: true } | { error: NextResponse };

async function requireAdmin(): Promise<Gate> {
  const session = await auth();
  if (!session) {
    return { error: NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 }) };
  }
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return { error: NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const current = await getBranding();
  return NextResponse.json({ hasLogo: !!current, v: current?.branding.v ?? null });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  let rootId: string;
  try {
    rootId = await getPrimaryRootIdOrThrow();
  } catch {
    return NextResponse.json({ error: "Najprv nastavte spoločenstvo" }, { status: 400 });
  }

  const form = await request.formData();
  const logo = form.get("logo") as File | null;
  if (!logo) {
    return NextResponse.json({ error: "Súbor je povinný" }, { status: 400 });
  }
  if (logo.size > MAX_LOGO_SIZE) {
    return NextResponse.json({ error: "Maximálna veľkosť je 500 KB" }, { status: 400 });
  }

  const logoBuf = Buffer.from(await logo.arrayBuffer());
  const sniff = sniffImage(logoBuf);
  if (!sniff || !ACCEPTED_LOGO_MIME[sniff.mime]) {
    return NextResponse.json(
      { error: "Nepovolený typ súboru (PNG, JPEG, WebP)" },
      { status: 400 }
    );
  }
  if (sniff.width > MAX_LOGO_DIM || sniff.height > MAX_LOGO_DIM) {
    return NextResponse.json(
      { error: `Maximálny rozmer je ${MAX_LOGO_DIM}px` },
      { status: 400 }
    );
  }

  const storage = getStorage();
  const stamp = crypto.randomUUID();
  const v = stamp.slice(0, 8);

  // Persist the original logo.
  const logoKey = `branding/${rootId}/${stamp}.${sniff.ext}`;
  await storage.put(logoKey, logoBuf, { contentType: sniff.mime, filename: `logo.${sniff.ext}` });

  // Persist the client-generated PWA icon variants (always PNG).
  const iconNames = ["icon192", "icon512", "maskable", "apple"] as const;
  const iconKeys: Record<(typeof iconNames)[number], string> = {
    icon192: "",
    icon512: "",
    maskable: "",
    apple: "",
  };
  for (const name of iconNames) {
    const file = form.get(name) as File | null;
    if (!file) {
      return NextResponse.json({ error: "Chýba vygenerovaná ikona" }, { status: 400 });
    }
    if (file.size > MAX_ICON_SIZE) {
      return NextResponse.json({ error: "Ikona je príliš veľká" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const s = sniffImage(buf);
    if (!s || s.mime !== ICON_MIME) {
      return NextResponse.json({ error: "Neplatná ikona" }, { status: 400 });
    }
    const key = `branding/${rootId}/${stamp}-${name}.png`;
    await storage.put(key, buf, { contentType: ICON_MIME, filename: `${name}.png` });
    iconKeys[name] = key;
  }

  const branding: BrandingData = {
    logo: logoKey,
    icon192: iconKeys.icon192,
    icon512: iconKeys.icon512,
    maskable: iconKeys.maskable,
    apple: iconKeys.apple,
    mime: sniff.mime,
    v,
  };

  // Capture the previous set BEFORE overwriting, then clean it up after.
  const prev = await getBranding();
  await setBranding(rootId, branding);
  if (prev) {
    for (const key of brandingStorageKeys(prev.branding)) {
      await storage.delete(key).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, v });
}

export async function DELETE() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const current = await getBranding();
  if (!current) return NextResponse.json({ ok: true });

  await setBranding(current.entityId, null);
  const storage = getStorage();
  for (const key of brandingStorageKeys(current.branding)) {
    await storage.delete(key).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

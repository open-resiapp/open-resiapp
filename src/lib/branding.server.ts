import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import type { BrandingData, BrandingAsset } from "@/lib/branding";

// BYT-20260512-008 — server side of the white-label logo feature.
//
// Branding lives on the PRIMARY ROOT entity (oldest top-level, not archived)
// in `entities.data.branding`. That mirrors how the rest of the instance
// config (name, address, country, legal_notice) is stored, and crucially
// needs NO session — so the login layout, transactional emails, and the web
// manifest can all resolve the logo before the user is authenticated.

/** Primary root id, or null when the community hasn't been bootstrapped yet. */
export async function getPrimaryRootId(): Promise<string | null> {
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(isNull(entities.parentId), isNull(entities.archivedAt)))
    .orderBy(entities.createdAt)
    .limit(1);
  return row?.id ?? null;
}

export async function getPrimaryRootIdOrThrow(): Promise<string> {
  const id = await getPrimaryRootId();
  if (!id) throw new Error("no-community-root");
  return id;
}

/** Active branding for the instance, or null when no logo is set. */
export async function getBranding(): Promise<{
  entityId: string;
  branding: BrandingData;
} | null> {
  const [row] = await db
    .select({
      id: entities.id,
      branding: sql<BrandingData | null>`${entities.data}->'branding'`,
    })
    .from(entities)
    .where(and(isNull(entities.parentId), isNull(entities.archivedAt)))
    .orderBy(entities.createdAt)
    .limit(1);
  if (!row || !row.branding || !row.branding.logo) return null;
  return { entityId: row.id, branding: row.branding };
}

/**
 * Write (or clear, with null) the branding object. Shallow jsonb merge
 * replaces the whole `branding` key — we always write/clear the full object
 * together — mirroring the `/api/building` data-patch style.
 */
export async function setBranding(
  entityId: string,
  branding: BrandingData | null
): Promise<void> {
  const patch = JSON.stringify({ branding });
  await db
    .update(entities)
    .set({ data: sql`${entities.data} || ${patch}::jsonb` })
    .where(eq(entities.id, entityId));
}

/** Resolve a logical asset name to its stored key for the active branding. */
export function assetKey(b: BrandingData, name: BrandingAsset): string | null {
  switch (name) {
    case "logo":
      return b.logo;
    case "icon192":
      return b.icon192;
    case "icon512":
      return b.icon512;
    case "maskable":
      return b.maskable;
    case "apple":
      return b.apple;
    default:
      return null;
  }
}

/** Every storage key referenced by a branding object (for cleanup on replace/delete). */
export function brandingStorageKeys(b: BrandingData): string[] {
  return [b.logo, b.icon192, b.icon512, b.maskable, b.apple].filter(
    (k): k is string => typeof k === "string" && k.startsWith("branding/")
  );
}

/** Absolute logo URL for transactional emails (mail clients fetch off-session). */
export function brandingLogoAbsoluteUrl(v: string): string {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  return `${base}/api/branding/asset/logo?v=${encodeURIComponent(v)}`;
}

// ---------------------------------------------------------------------------
// Magic-byte image sniffing (no image library is installed — see package.json)
// ---------------------------------------------------------------------------

export interface Sniffed {
  mime: string;
  ext: string;
  width: number; // 0 when dimensions could not be parsed (caller skips dim check)
  height: number;
}

/**
 * Identify an image by its MAGIC BYTES (never trust the client MIME) and read
 * pixel dimensions for PNG / JPEG / WebP. Returns null for anything else.
 * Dimension parsing is best-effort: 0×0 is returned when it can't be read,
 * and the size cap remains the hard guard.
 */
export function sniffImage(buf: Buffer): Sniffed | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A; IHDR width/height = uint32 BE at 16 / 20.
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      mime: "image/png",
      ext: "png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG: FF D8 …; scan SOF markers for the frame dimensions.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const d = jpegDims(buf);
    return { mime: "image/jpeg", ext: "jpg", width: d?.w ?? 0, height: d?.h ?? 0 };
  }
  // WebP: "RIFF"…"WEBP".
  if (
    buf.length >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    const d = webpDims(buf);
    return { mime: "image/webp", ext: "webp", width: d?.w ?? 0, height: d?.h ?? 0 };
  }
  return null;
}

const PLAUSIBLE = (n: number) => n > 0 && n <= 20000;

function jpegDims(buf: Buffer): { w: number; h: number } | null {
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    // SOF0..SOF15 carry frame dims; exclude DHT(C4) JPG(C8) DAC(CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const h = buf.readUInt16BE(off + 5);
      const w = buf.readUInt16BE(off + 7);
      return PLAUSIBLE(w) && PLAUSIBLE(h) ? { w, h } : null;
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

function webpDims(buf: Buffer): { w: number; h: number } | null {
  const fmt = buf.toString("ascii", 12, 16);
  if (fmt === "VP8 ") {
    // Lossy: 14-bit width/height (LE) after the 3-byte start code at 23..25.
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return PLAUSIBLE(w) && PLAUSIBLE(h) ? { w, h } : null;
  }
  if (fmt === "VP8L") {
    // Lossless: signature 0x2f at 20, then 14-bit (w-1), 14-bit (h-1), LSB-first.
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return PLAUSIBLE(w) && PLAUSIBLE(h) ? { w, h } : null;
  }
  if (fmt === "VP8X") {
    // Extended: 24-bit LE (w-1) at 24, (h-1) at 27.
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return PLAUSIBLE(w) && PLAUSIBLE(h) ? { w, h } : null;
  }
  return null;
}

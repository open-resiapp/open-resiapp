// BYT-20260512-008 — per-instance white-label logo + PWA icon.
//
// Client-safe constants + types ONLY. Server APIs (DB, storage, magic-byte
// sniffing) live in `branding.server.ts` (import "server-only"). This split
// keeps the upload UI (client) able to import the limits/types without
// dragging the DB driver into the client bundle.

/**
 * Accepted MIME → extension for the ORIGINAL uploaded logo. Raster only —
 * SVG is deferred (inline-SVG XSS risk); see the spec Notes. Validation is by
 * magic bytes server-side, never the client-declared MIME.
 */
export const ACCEPTED_LOGO_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Comma list for the <input accept="…"> attribute. */
export const ACCEPTED_LOGO_ACCEPT = Object.keys(ACCEPTED_LOGO_MIME).join(",");

export const MAX_LOGO_SIZE = 500 * 1024; // 500 KB — the original upload
export const MAX_LOGO_DIM = 1024; // px — longest side of the original
/** Generated PWA icon PNGs are small; cap defensively on the server. */
export const MAX_ICON_SIZE = 1024 * 1024;

// --- Derived PWA icon variants (square PNGs, generated client-side) ---
export const ICON_SIZE_192 = 192;
export const ICON_SIZE_512 = 512;
export const APPLE_TOUCH_SIZE = 180;
/**
 * Maskable safe zone — keep the glyph within the inner ~80% so Android's
 * adaptive-icon mask can't clip it.
 */
export const MASKABLE_SAFE_RATIO = 0.8;
/** Apple touch icons get a little padding too; iOS applies its own rounding. */
export const APPLE_SAFE_RATIO = 0.92;
export const ICON_MIME = "image/png";
/**
 * Background for OPAQUE icons (apple-touch + maskable). iOS turns
 * transparency into black, so we paint white behind arbitrary logos.
 */
export const ICON_BG = "#ffffff";

/** Logical asset names served publicly by /api/branding/asset/[name]. */
export const BRANDING_ASSETS = [
  "logo",
  "icon192",
  "icon512",
  "maskable",
  "apple",
] as const;
export type BrandingAsset = (typeof BRANDING_ASSETS)[number];

/**
 * Persisted at `entities.data.branding` on the primary root entity (one logo
 * per instance — "per-building" logos are explicitly out of scope).
 */
export interface BrandingData {
  logo: string; // storage key of the original logo (in-app / login / email)
  icon192: string;
  icon512: string;
  maskable: string;
  apple: string;
  mime: string; // original logo MIME (for serving the `logo` asset)
  v: string; // short version token — cache-busts asset URLs on change
}

/** Build a cache-busted public asset URL (relative — for in-app + manifest). */
export function brandingAssetPath(name: BrandingAsset, v: string): string {
  return `/api/branding/asset/${name}?v=${encodeURIComponent(v)}`;
}

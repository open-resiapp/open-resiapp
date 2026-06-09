import { NextRequest, NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";
import { getBranding, assetKey } from "@/lib/branding.server";
import { BRANDING_ASSETS, type BrandingAsset } from "@/lib/branding";

// BYT-20260512-008 — PUBLIC branding asset bytes (logo + derived PWA icons).
//
// No auth: these are non-sensitive and MUST load on the pre-auth login page,
// inside transactional emails, and in the web manifest. Call sites cache-bust
// with ?v=<branding version>, so a present `v` gets an immutable long cache
// while the version-less apple-touch <link> gets a short cache instead.
//
// Icon variants fall back to the bundled default icons when no custom branding
// exists, so the manifest + apple-touch-icon never 404. The `logo` asset has
// no default — in-app render only links to it when a logo is actually set.
const DEFAULT_FALLBACK: Record<BrandingAsset, string | null> = {
  logo: null,
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  maskable: "/icon-maskable-512.png",
  apple: "/icon-192.png",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!BRANDING_ASSETS.includes(name as BrandingAsset)) {
    return new NextResponse(null, { status: 404 });
  }
  const asset = name as BrandingAsset;

  const current = await getBranding();
  const key = current ? assetKey(current.branding, asset) : null;

  if (!key) {
    const fb = DEFAULT_FALLBACK[asset];
    return fb
      ? NextResponse.redirect(new URL(fb, req.url))
      : new NextResponse(null, { status: 404 });
  }

  const obj = await getStorage().get(key);
  if (!obj) {
    const fb = DEFAULT_FALLBACK[asset];
    return fb
      ? NextResponse.redirect(new URL(fb, req.url))
      : new NextResponse(null, { status: 404 });
  }

  const versioned = req.nextUrl.searchParams.has("v");
  const cacheControl = versioned
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";

  return new NextResponse(new Uint8Array(obj.body), {
    status: 200,
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": cacheControl,
    },
  });
}

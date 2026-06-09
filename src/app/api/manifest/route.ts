import { NextResponse } from "next/server";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { getBranding } from "@/lib/branding.server";
import { brandingAssetPath } from "@/lib/branding";

// Default bundled icons — used until an instance uploads its own logo
// (BYT-20260512-008). Raster sizes are required for Chrome/Android
// installability; `beforeinstallprompt` will not fire with an SVG-only manifest.
const DEFAULT_ICONS = [
  { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  // Full-bleed variant so Android's adaptive-icon mask doesn't clip the glyph.
  {
    src: "/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export async function GET() {
  let appName = process.env.APP_NAME || "OpenResiApp";
  let icons = DEFAULT_ICONS;

  try {
    const root = await getCommunityRoot();
    if (root?.name) {
      appName = root.name;
    }
    // White-label: serve the instance's own square PNG icons (generated at
    // upload). Cache-busted by ?v= so a new logo updates fresh installs.
    const branding = await getBranding();
    if (branding) {
      const { v } = branding.branding;
      icons = [
        {
          src: brandingAssetPath("icon192", v),
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: brandingAssetPath("icon512", v),
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: brandingAssetPath("maskable", v),
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ];
    }
  } catch {
    // DB not available — use env + default-icon fallback.
  }

  return NextResponse.json({
    name: appName,
    short_name: appName,
    description: "Residential building management",
    start_url: "/",
    display: "standalone",
    theme_color: "#2563eb",
    background_color: "#f9fafb",
    icons,
  });
}

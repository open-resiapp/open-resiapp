import { NextResponse } from "next/server";
import { getCommunityRoot } from "@/lib/legacy-compat";

export async function GET() {
  let appName = process.env.APP_NAME || "OpenResiApp";

  try {
    const root = await getCommunityRoot();
    if (root?.name) {
      appName = root.name;
    }
  } catch {
    // DB not available — use env fallback
  }

  return NextResponse.json({
    name: appName,
    short_name: appName,
    description: "Residential building management",
    start_url: "/",
    display: "standalone",
    theme_color: "#2563eb",
    background_color: "#f9fafb",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      // Raster icons are required for Chrome/Android installability — the
      // `beforeinstallprompt` event will not fire with an SVG-only manifest.
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Full-bleed variant so Android's adaptive-icon mask doesn't clip the glyph.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });
}

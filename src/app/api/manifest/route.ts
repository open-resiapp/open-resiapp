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
    ],
  });
}

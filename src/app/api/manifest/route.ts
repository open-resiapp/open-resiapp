import { NextResponse } from "next/server";

export async function GET() {
  const appName = process.env.APP_NAME || "OpenResiApp";

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

import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { isAllowlistedForWrite, isReadonly } from "./lib/readonly";

const intlMiddleware = createMiddleware(routing);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Read-only gate: when `IS_READONLY=true`, block non-GET API calls except
  // for the auth/health allowlist. Server actions are NOT covered here —
  // they bypass middleware; mutating actions must call `assertWritable()`.
  if (pathname.startsWith("/api/")) {
    if (
      isReadonly() &&
      WRITE_METHODS.has(req.method) &&
      !isAllowlistedForWrite(pathname)
    ) {
      return NextResponse.json(
        {
          error: "read_only",
          message:
            "Inštancia je v režime iba na čítanie. Zápis je počas tohto obdobia zablokovaný.",
        },
        { status: 423 }
      );
    }
    return NextResponse.next();
  }

  return intlMiddleware(req);
}

export const config = {
  // Include /api so the read-only check can run; exclude static + Next internals.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};

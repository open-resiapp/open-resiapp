import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { isAllowlistedForWrite, isReadonly } from "./lib/readonly";

const intlMiddleware = createMiddleware(routing);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // OAuth / MCP discovery documents (BYT-20261117-001) are locale-free —
  // never let the i18n middleware prefix or rewrite them. (Paths with a dot
  // are already outside the matcher; this keeps it explicit.)
  if (pathname.startsWith("/.well-known/")) {
    return NextResponse.next();
  }

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

  // Original path + query for the dashboard layout's post-login redirect
  // (callbackUrl). `set` overwrites any client-supplied value — the header is
  // ours only; the layout additionally validates it (same locale, no `//`,
  // no backslash, no auth pages). next-intl 4.x copies request headers into
  // its NextResponse.next/rewrite, so the header reaches server components.
  const h = new Headers(req.headers);
  h.set("x-resiapp-path", pathname + req.nextUrl.search);
  return intlMiddleware(new NextRequest(req, { headers: h }));
}

export const config = {
  // Include /api so the read-only check can run; exclude static + Next internals.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};

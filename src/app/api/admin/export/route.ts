import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  exportCommunityAsImportRows,
  flattenForExport,
} from "@/lib/import/export";
import { generateCsvTemplate } from "@/lib/import/formats/csv";
import { generateXlsxTemplate } from "@/lib/import/formats/xlsx";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the current community state in the Easy Import column schema.
 * Used by:
 *   - Admin UI (advanced section of /admin/import)
 *   - Cloud platform's go-live data migration tooling
 *
 * Auth: admin session OR a bearer token matching `PLATFORM_IMPORT_TOKEN`
 * (the same secret used by /api/internal/import-identity — single per-instance
 * secret injected by cloud at provision).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "xlsx") as "xlsx" | "csv";
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }

  const authorized = await isAuthorized(req);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await exportCommunityAsImportRows();
  if (!result) {
    return NextResponse.json({ error: "no_community" }, { status: 404 });
  }

  const dataRows = flattenForExport(result);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = generateCsvTemplate(result.structure, dataRows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="export-${result.structure}-${stamp}.csv"`,
      },
    });
  }

  const xlsx = generateXlsxTemplate(result.structure, dataRows);
  // Uint8Array<ArrayBuffer> wrap — @types/node 20.19+ types Buffer as
  // Buffer<ArrayBufferLike>, not assignable to BodyInit.
  return new NextResponse(new Uint8Array(Buffer.from(xlsx)), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export-${result.structure}-${stamp}.xlsx"`,
    },
  });
}

async function isAuthorized(req: Request): Promise<boolean> {
  // Path 1: admin session (browser-side click in /admin/import).
  try {
    const session = await auth();
    if (session?.user?.role) {
      const role = session.user.role as UserRole;
      if (hasPermission(role, "manageSettings")) return true;
    }
  } catch {
    // fall through to token check
  }

  // Path 2: cloud platform calls with bearer token. Constant-time compare.
  const expected = process.env.PLATFORM_IMPORT_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const presented = match[1].trim();
  return timingSafeEqual(presented, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

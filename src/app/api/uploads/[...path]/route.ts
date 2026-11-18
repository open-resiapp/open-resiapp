import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFile, stat } from "fs/promises";
import path from "path";
import { getUploadsDir } from "@/lib/uploads";
import { canReadUploadCategory } from "@/lib/uploads-access";
import type { UserRole } from "@/types";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// GET /api/uploads/<category>/<file> — serves ONLY the image categories that
// POST /api/uploads writes itself (see src/lib/uploads-access.ts). The local
// storage driver shares this root with access-controlled objects (documents/,
// accounting…, branding/), which have their own auth-gated proxy routes and
// must never be reachable here. BYT-20261118-005 G1.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const segments = (await params).path;

  // Security: prevent directory traversal
  if (segments.some((s) => s.includes("..") || s.includes("~"))) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  // Allowlist: exactly <category>/<file>, category served by this route.
  // Unknown / protected prefixes answer 404 (don't confirm existence).
  if (
    segments.length !== 2 ||
    !canReadUploadCategory(segments[0], session.user.role as UserRole)
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ext = path.extname(segments[1]).slice(1).toLowerCase();
  const contentType = MIME_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const uploadsDir = getUploadsDir();
  const filePath = path.join(uploadsDir, ...segments);
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const fileBuffer = await readFile(filePath);

  // Uint8Array<ArrayBuffer> wrap — @types/node 20.19+ types Buffer as
  // Buffer<ArrayBufferLike>, not assignable to BodyInit.
  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFile, stat } from "fs/promises";
import path from "path";
import { getUploadsDir } from "@/lib/uploads";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const segments = (await params).path;

  // Security: prevent directory traversal
  if (segments.some((s) => s.includes("..") || s.includes("~"))) {
    return NextResponse.json({ error: "Neplatná cesta" }, { status: 400 });
  }

  const uploadsDir = getUploadsDir();
  const filePath = path.join(uploadsDir, ...segments);
  if (!filePath.startsWith(uploadsDir)) {
    return NextResponse.json({ error: "Neplatná cesta" }, { status: 400 });
  }

  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Súbor nenájdený" }, { status: 404 });
  }

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const fileBuffer = await readFile(filePath);

  // Uint8Array<ArrayBuffer> wrap — @types/node 20.19+ types Buffer as
  // Buffer<ArrayBufferLike>, not assignable to BodyInit.
  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}

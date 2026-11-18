import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { UPLOAD_CATEGORIES, isUploadCategory } from "@/lib/uploads-access";
import type { UserRole } from "@/types";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getUploadsDir } from "@/lib/uploads";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) || "paper-votes";

  // Category allowlist shared with GET /api/uploads/[...path] (G1).
  if (!isUploadCategory(category)) {
    return NextResponse.json({ error: "Neznáma kategória" }, { status: 400 });
  }
  const requiredPermission = UPLOAD_CATEGORIES[category].write;

  if (!hasPermission(session.user.role as UserRole, requiredPermission)) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  if (!file) {
    return NextResponse.json({ error: "Súbor je povinný" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Povolené sú iba obrázky (JPEG, PNG, WebP)" },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Maximálna veľkosť súboru je 10 MB" },
      { status: 400 }
    );
  }

  // Sanitize category to prevent directory traversal
  const safeCategory = category.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const filename = `${crypto.randomUUID()}.${ext}`;

  const uploadDir = path.join(getUploadsDir(), safeCategory);
  await mkdir(uploadDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);

  const url = `/api/uploads/${safeCategory}/${filename}`;
  return NextResponse.json({ url }, { status: 201 });
}

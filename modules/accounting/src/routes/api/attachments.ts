import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";
import { getStorage } from "@/lib/storage";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { entities, memberships } from "@/db/schema";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import { domUnitsWhere } from "@modules/accounting/src/lib/dom-units";
import {
  listAttachments,
  listInspectExpenses,
  resolveAttachmentDownload,
  setVisibility,
  uploadAttachment,
  voidAttachment,
} from "@modules/accounting/src/lib/attachments";

// Attachments + right-to-inspect API. Uploads/visibility/void are
// writer-only; downloads and the inspect list are open to any OWNER of
// the dom (whole-dom transparency) but filtered by doklad visibility.

type Ctx =
  | { error: NextResponse; session?: never; root?: never }
  | { error?: never; session: Session; root: CommunityRootRow };

async function baseCtx(): Promise<Ctx> {
  const session = await auth();
  if (!session)
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const root = await getCommunityRoot();
  if (!root)
    return { error: NextResponse.json({ error: "no community" }, { status: 404 }) };
  return { session, root };
}

/** True for admin/board or any active owner of a unit in the dom. */
async function isDomMember(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  if (userRole === "admin") return true;
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
        domUnitsWhere(entityId)
      )
    )
    .limit(1);
  return !!row;
}

async function requireWriter(ctx: {
  session: Session;
  root: CommunityRootRow;
}): Promise<boolean> {
  return canWriteAccounting(
    ctx.session.user.id,
    ctx.session.user.role as string,
    ctx.root.id
  );
}

const MAX_BYTES = 15 * 1024 * 1024;

/** POST /api/accounting/expenses/[id]/attachments — multipart upload. */
export async function handleUpload(
  req: NextRequest,
  expenseId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  if (!(await requireWriter(ctx)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const role = form.get("role") === "redacted" ? "redacted" : "original";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file over 15 MB" }, { status: 413 });
  }

  try {
    const result = await uploadAttachment({
      entityId: ctx.root.id,
      expenseId,
      role,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      body: Buffer.from(await file.arrayBuffer()),
      actorId: ctx.session.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** GET /api/accounting/expenses/[id]/attachments — board list. */
export async function handleListForExpense(
  _req: NextRequest,
  expenseId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  if (!(await requireWriter(ctx)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await listAttachments(ctx.root.id, expenseId);
  return NextResponse.json({ attachments: rows });
}

/** PATCH /api/accounting/expenses/[id]/visibility — { visibility, justification }. */
export async function handleSetVisibility(
  req: NextRequest,
  expenseId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  if (!(await requireWriter(ctx)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { visibility?: string; justification?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const v = body.visibility;
  if (v !== "public" && v !== "redacted_required" && v !== "restricted") {
    return NextResponse.json({ error: "invalid visibility" }, { status: 400 });
  }
  try {
    await setVisibility({
      entityId: ctx.root.id,
      expenseId,
      visibility: v,
      justification: typeof body.justification === "string" ? body.justification : null,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST /api/accounting/attachments/[id]/void */
export async function handleVoid(
  _req: NextRequest,
  attachmentId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  if (!(await requireWriter(ctx)))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await voidAttachment({
      entityId: ctx.root.id,
      attachmentId,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "void failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/** GET /api/accounting/attachments/[id]/download — auth-gated proxy. */
export async function handleDownload(
  _req: NextRequest,
  attachmentId: string
): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  if (!(await isDomMember(session.user.id, session.user.role as string, root.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const resolved = await resolveAttachmentDownload({
    entityId: root.id,
    attachmentId,
    userId: session.user.id,
    userRole: session.user.role as string,
  });
  if (!resolved) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const obj = await getStorage().get(resolved.storageKey);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(obj.body), {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "Content-Disposition": `inline; filename="${resolved.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** GET /api/accounting/inspect — right-to-inspect list for dom owners. */
export async function handleInspect(): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  if (!(await isDomMember(session.user.id, session.user.role as string, root.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await listInspectExpenses({
    entityId: root.id,
    userId: session.user.id,
    userRole: session.user.role as string,
  });
  return NextResponse.json({ expenses: rows });
}

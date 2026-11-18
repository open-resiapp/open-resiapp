import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDocumentWithPath, isBoardForPath } from "@/lib/documents.server";
import {
  documentEmailAttachmentMax,
  listSendRecipients,
  sendDocumentByEmail,
} from "@/lib/document-send.server";
import { DOCUMENT_EMAIL_MESSAGE_MAX } from "@/lib/documents";

// "Poslať e-mailom" — BYT-20261118-005 Phase D. Board only (admin membership
// on the document's line); everyone else gets 404.

async function loadForBoard(userId: string, id: string) {
  const found = await getDocumentWithPath(id);
  if (!found || !(await isBoardForPath(userId, found.path))) return null;
  return found.doc;
}

const notFound = () =>
  NextResponse.json(
    { error: "document.not_found", code: "document.not_found" },
    { status: 404 }
  );

// GET — candidate recipients + whether the doc goes as attachment or link.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const doc = await loadForBoard(session.user.id, id);
  if (!doc) return notFound();

  const max = documentEmailAttachmentMax();
  return NextResponse.json({
    boardOnly: doc.audience === "admin",
    mode: doc.sizeBytes != null && doc.sizeBytes <= max ? "attachment" : "link",
    attachmentMaxBytes: max,
    recipients: await listSendRecipients(doc),
  });
}

// POST { recipientUserId, message? } — send once. Irreversible.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const doc = await loadForBoard(session.user.id, id);
  if (!doc) return notFound();

  const body = (await request.json().catch(() => ({}))) as {
    recipientUserId?: unknown;
    message?: unknown;
  };
  const recipientUserId =
    typeof body.recipientUserId === "string" ? body.recipientUserId : "";
  const message =
    typeof body.message === "string"
      ? body.message.slice(0, DOCUMENT_EMAIL_MESSAGE_MAX)
      : null;

  const result = await sendDocumentByEmail({
    doc,
    actorUserId: session.user.id,
    recipientUserId,
    message,
  });
  if (!result.ok) {
    const status =
      result.code === "document.send.throttled"
        ? 429
        : result.code === "document.send.failed"
          ? 502
          : 400;
    return NextResponse.json({ error: result.code, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, mode: result.mode });
}

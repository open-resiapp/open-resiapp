import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDocumentWithPath, isBoardForPath } from "@/lib/documents.server";
import {
  documentEmailAttachmentMax,
  listSendRecipients,
  sendDocumentByEmail,
  sendDocumentToAllOwners,
} from "@/lib/document-send.server";
import { isSmtpConfigured } from "@/lib/email";
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
    smtpConfigured: isSmtpConfigured(),
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
    all?: unknown;
    expectedCount?: unknown;
  };
  const recipientUserId =
    typeof body.recipientUserId === "string" ? body.recipientUserId : "";
  const message =
    typeof body.message === "string"
      ? body.message.slice(0, DOCUMENT_EMAIL_MESSAGE_MAX)
      : null;

  // Bulk: { all: true, expectedCount } — the count the board confirmed.
  if (body.all === true) {
    const expectedCount = typeof body.expectedCount === "number" ? body.expectedCount : -1;
    const bulk = await sendDocumentToAllOwners({
      doc,
      actorUserId: session.user.id,
      message,
      expectedCount,
    });
    if (!bulk.ok) {
      const status =
        bulk.code === "document.send.count_changed"
          ? 409
          : bulk.code === "document.send.smtp_missing"
            ? 503
            : 400;
      return NextResponse.json({ error: bulk.code, code: bulk.code }, { status });
    }
    return NextResponse.json({ ok: true, summary: bulk.summary });
  }

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
          : result.code === "document.send.smtp_missing"
            ? 503
          : 400;
    return NextResponse.json({ error: result.code, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, mode: result.mode });
}

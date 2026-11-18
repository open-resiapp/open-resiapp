import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  communityNotificationsSent,
  entities,
  memberships,
  users,
} from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { sendDocumentToOwner } from "@/lib/email";
import { routing } from "@/i18n/routing";
import {
  DOCUMENT_EMAIL_ATTACHMENT_MAX_DEFAULT,
  DOCUMENT_EMAIL_MESSAGE_MAX,
  type DocumentErrorCode,
} from "@/lib/documents";
import {
  getViewableDocument,
  logDocumentEmailSent,
  type DocumentRow,
} from "@/lib/documents.server";

// "Poslať e-mailom" — BYT-20261118-005 Phase D. The board sends one document
// to one owner who may ALREADY see it. Never widens visibility, never copies
// or moves the document. Dedupe: one send per (document, recipient) per
// THROTTLE_MINUTES via community_notifications_sent (kind document_sent).

const THROTTLE_MINUTES = 10;

export function documentEmailAttachmentMax(): number {
  const raw = Number(process.env.DOCUMENT_EMAIL_ATTACHMENT_MAX);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DOCUMENT_EMAIL_ATTACHMENT_MAX_DEFAULT;
}

export interface SendRecipientOption {
  id: string;
  name: string;
  hasEmail: boolean;
  /** Passes the visibility resolver for this document right now. */
  canSee: boolean;
}

/**
 * People the board may send this document to: the owner-folder subject, or —
 * for a doc without subject — the active owners of the anchor entity itself
 * (a unit). A building-wide doc has no implicit recipients (bulk send is out
 * of scope).
 */
export async function listSendRecipients(
  doc: DocumentRow
): Promise<SendRecipientOption[]> {
  let ids: string[];
  if (doc.subjectUserId) {
    ids = [doc.subjectUserId];
  } else {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.entityId, doc.entityId),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active")
        )
      );
    ids = [...new Set(rows.map((r) => r.userId))];
  }
  if (!ids.length) return [];
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  const out: SendRecipientOption[] = [];
  for (const p of people) {
    out.push({
      id: p.id,
      name: p.name,
      hasEmail: !!p.email,
      canSee: !!(await getViewableDocument(p.id, doc.id)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type SendResult =
  | { ok: true; mode: "attachment" | "link" }
  | { ok: false; code: DocumentErrorCode };

export async function sendDocumentByEmail(input: {
  doc: DocumentRow;
  actorUserId: string;
  recipientUserId: string;
  message?: string | null;
}): Promise<SendResult> {
  const { doc, actorUserId, recipientUserId } = input;

  // Board-only docs are refused outright — the UI offers a visibility PATCH
  // instead (audited), we never auto-widen.
  if (doc.audience === "admin") return { ok: false, code: "document.send.board_only" };

  const allowed = await listSendRecipients(doc);
  const target = allowed.find((r) => r.id === recipientUserId);
  if (!target) return { ok: false, code: "document.send.no_recipient" };
  // Recipient must pass the SAME resolver as a download would.
  if (!target.canSee) return { ok: false, code: "document.send.board_only" };

  const [recipient] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, recipientUserId))
    .limit(1);
  if (!recipient?.email) return { ok: false, code: "document.send.no_email" };

  const max = documentEmailAttachmentMax();
  const fits = doc.sizeBytes != null && doc.sizeBytes <= max;
  // Shell owners (no login) can't open a link — attachment only.
  if (!fits && !recipient.passwordHash) {
    return { ok: false, code: "document.send.too_large_no_account" };
  }

  // Claim the (document, recipient) slot under a transaction-scoped advisory
  // lock so two replicas / double clicks can't both pass the throttle check.
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`document_sent:${doc.id}:${recipient.id}`}))`
    );
    const since = new Date(Date.now() - THROTTLE_MINUTES * 60_000);
    const [recent] = await tx
      .select({ id: communityNotificationsSent.id })
      .from(communityNotificationsSent)
      .where(
        and(
          eq(communityNotificationsSent.documentId, doc.id),
          eq(communityNotificationsSent.recipientId, recipient.id),
          eq(communityNotificationsSent.kind, "document_sent"),
          gt(communityNotificationsSent.sentAt, since)
        )
      )
      .limit(1);
    if (recent) return null;
    const [row] = await tx
      .insert(communityNotificationsSent)
      .values({
        documentId: doc.id,
        recipientId: recipient.id,
        kind: "document_sent",
      })
      .returning({ id: communityNotificationsSent.id });
    return row.id;
  });
  if (!claimed) return { ok: false, code: "document.send.throttled" };

  const release = () =>
    db
      .delete(communityNotificationsSent)
      .where(eq(communityNotificationsSent.id, claimed));

  let attachment: { filename: string; content: Buffer; contentType: string } | null =
    null;
  if (fits) {
    const obj = await getStorage().get(doc.storageKey);
    if (!obj) {
      await release();
      return { ok: false, code: "document.send.failed" };
    }
    attachment = {
      filename: doc.originalName || doc.name,
      content: obj.body,
      contentType: doc.mimeType || obj.contentType,
    };
  }

  const [anchor] = await db
    .select({ rootId: entities.rootId })
    .from(entities)
    .where(eq(entities.id, doc.entityId))
    .limit(1);
  const [root] = anchor
    ? await db
        .select({ name: entities.name })
        .from(entities)
        .where(eq(entities.id, anchor.rootId))
        .limit(1)
    : [];
  const [sender] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);

  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const message = input.message?.trim().slice(0, DOCUMENT_EMAIL_MESSAGE_MAX) || null;

  const ok = await sendDocumentToOwner({
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    documentName: doc.name,
    buildingName: root?.name ?? null,
    senderName: sender?.name ?? null,
    message,
    attachment,
    linkUrl: attachment ? null : `${base}/documents?doc=${doc.id}`,
    // TODO(decision): users have no stored locale yet — send in the instance
    // default language (LANGUAGE env) until a per-user locale exists.
    locale: routing.defaultLocale,
  });
  if (!ok) {
    await release();
    return { ok: false, code: "document.send.failed" };
  }

  const mode = attachment ? "attachment" : "link";
  await logDocumentEmailSent(doc.id, actorUserId, recipient.id, mode);
  return { ok: true, mode };
}

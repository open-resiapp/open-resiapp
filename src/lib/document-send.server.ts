import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { UNIT_HOLDER_ROLES } from "@/lib/role-options";

import { db } from "@/db";
import {
  communityNotificationsSent,
  entities,
  memberships,
  users,
} from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { isSmtpConfigured, sendDocumentToOwner } from "@/lib/email";
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
 * for a doc without subject — the active owners of the anchor entity (a unit)
 * or, for a building / entrance level document, of every unit below it
 * (materialized path). Each is still checked against the visibility resolver
 * (`canSee`) before anything is sent.
 */
export async function listSendRecipients(
  doc: DocumentRow
): Promise<SendRecipientOption[]> {
  let ids: string[];
  if (doc.subjectUserId) {
    ids = [doc.subjectUserId];
  } else {
    const [anchor] = await db
      .select({ path: entities.path })
      .from(entities)
      .where(eq(entities.id, doc.entityId))
      .limit(1);
    const rows = anchor
      ? await db
          .select({ userId: memberships.userId })
          .from(memberships)
          .innerJoin(entities, eq(entities.id, memberships.entityId))
          .where(
            and(
              sql`(${entities.id} = ${doc.entityId} OR ${entities.path} LIKE ${anchor.path} || '%')`,
              inArray(memberships.role, UNIT_HOLDER_ROLES),
              eq(memberships.status, "active")
            )
          )
      : [];
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
  /** Bulk send resolves the candidate list once (canSee is one query per person). */
  preResolved?: SendRecipientOption[];
}): Promise<SendResult> {
  const { doc, actorUserId, recipientUserId } = input;

  // Never skip silently: tell the board nothing can be sent from this instance.
  if (!isSmtpConfigured()) return { ok: false, code: "document.send.smtp_missing" };

  // Board-only docs are refused outright — the UI offers a visibility PATCH
  // instead (audited), we never auto-widen.
  if (doc.audience === "admin") return { ok: false, code: "document.send.board_only" };

  const allowed = input.preResolved ?? (await listSendRecipients(doc));
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

export interface BulkSendSummary {
  /** Owners eligible right now (has e-mail, passes the visibility resolver). */
  eligible: number;
  sent: number;
  /** Per-recipient failures by code (throttled, too_large_no_account, failed, …). */
  failed: Record<string, number>;
  /** Candidates left out up front: no e-mail / cannot see the document. */
  noEmail: number;
  cannotSee: number;
}

/** Recipients a bulk send would reach: has e-mail AND may see the document. */
export function eligibleForBulk(all: SendRecipientOption[]): SendRecipientOption[] {
  return all.filter((r) => r.hasEmail && r.canSee);
}

/**
 * "Send to all owners with e-mail". Reuses sendDocumentByEmail per recipient,
 * so board-only refusal, the visibility check, the per-(document, recipient)
 * advisory-lock throttle and the audit log all stay in force. `expectedCount`
 * is the number the board confirmed in the dialog; if the eligible set changed
 * since, nothing is sent (count_changed) and the dialog re-confirms.
 */
export async function sendDocumentToAllOwners(input: {
  doc: DocumentRow;
  actorUserId: string;
  message?: string | null;
  expectedCount: number;
}): Promise<
  | { ok: true; summary: BulkSendSummary }
  | { ok: false; code: DocumentErrorCode }
> {
  const { doc, actorUserId } = input;
  if (doc.audience === "admin") return { ok: false, code: "document.send.board_only" };
  if (!isSmtpConfigured()) return { ok: false, code: "document.send.smtp_missing" };

  const all = await listSendRecipients(doc);
  const eligible = eligibleForBulk(all);
  if (eligible.length === 0) return { ok: false, code: "document.send.no_recipient" };
  if (eligible.length !== input.expectedCount) {
    return { ok: false, code: "document.send.count_changed" };
  }

  const summary: BulkSendSummary = {
    eligible: eligible.length,
    sent: 0,
    failed: {},
    noEmail: all.filter((r) => !r.hasEmail).length,
    cannotSee: all.filter((r) => r.hasEmail && !r.canSee).length,
  };
  for (const r of eligible) {
    const res = await sendDocumentByEmail({
      doc,
      actorUserId,
      recipientUserId: r.id,
      message: input.message,
      preResolved: all,
    });
    if (res.ok) summary.sent += 1;
    else summary.failed[res.code] = (summary.failed[res.code] ?? 0) + 1;
  }
  return { ok: true, summary };
}

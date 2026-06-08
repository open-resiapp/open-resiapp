import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documents,
  documentAccessLog,
  entities,
  memberships,
  users,
} from "@/db/schema";
import {
  canSeeDocPath,
  type DocumentAudience,
  type DocumentType,
  type UserMembershipLite,
} from "@/lib/documents";

// Server DB layer for the document library. Visibility predicate
// (`canSeeDocPath`) is the pure, client-safe source of truth in documents.ts;
// here we just feed it data. BYT-20260512-006.

export type DocumentRow = typeof documents.$inferSelect;

/** Active memberships of the user, each with its entity's (trailing-slash) path. */
export async function loadUserMemberships(
  userId: string
): Promise<UserMembershipLite[]> {
  const rows = await db
    .select({ role: memberships.role, path: entities.path })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(eq(memberships.userId, userId), eq(memberships.status, "active"))
    );
  return rows.map((r) => ({ entityPath: r.path, role: r.role }));
}

export type DocumentListItem = DocumentRow & { uploaderName: string | null };

/**
 * Documents visible to the user within the subtree of `scopeEntityId`
 * (typically their current building root). Non-deleted only. Visibility is
 * resolved in-memory against the user's memberships — one membership query, no
 * per-document round-trip. Each row is enriched with the uploader's name.
 */
export async function listVisibleDocuments(
  userId: string,
  scopeEntityId: string,
  opts: { type?: DocumentType } = {}
): Promise<DocumentListItem[]> {
  const [scope] = await db
    .select({ path: entities.path })
    .from(entities)
    .where(eq(entities.id, scopeEntityId))
    .limit(1);
  if (!scope) return [];

  const conditions = [
    isNull(documents.deletedAt),
    sql`${entities.path} LIKE ${scope.path + "%"}`,
  ];
  if (opts.type) conditions.push(eq(documents.type, opts.type));

  const rows = await db
    .select({ doc: documents, path: entities.path, uploaderName: users.name })
    .from(documents)
    .innerJoin(entities, eq(documents.entityId, entities.id))
    .leftJoin(users, eq(documents.uploadedById, users.id))
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt));

  const mems = await loadUserMemberships(userId);
  return rows
    .filter((r) => canSeeDocPath(mems, r.path, r.doc.audience))
    .map((r) => ({ ...r.doc, uploaderName: r.uploaderName }));
}

/** Returns the document if the user may view it; null if missing OR forbidden. */
export async function getViewableDocument(
  userId: string,
  documentId: string
): Promise<DocumentRow | null> {
  const [row] = await db
    .select({ doc: documents, path: entities.path })
    .from(documents)
    .innerJoin(entities, eq(documents.entityId, entities.id))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!row) return null;
  const mems = await loadUserMemberships(userId);
  return canSeeDocPath(mems, row.path, row.doc.audience) ? row.doc : null;
}

/** Raw fetch for management (delete) — no visibility filter; caller authorizes. */
export async function getManageableDocument(
  documentId: string
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  return row ?? null;
}

export interface CreateDocumentInput {
  entityId: string;
  uploadedById: string;
  name: string;
  storageKey: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  type: DocumentType;
  audience: DocumentAudience;
  retainUntil?: string | null; // ISO date (YYYY-MM-DD)
}

export async function createDocument(
  input: CreateDocumentInput
): Promise<DocumentRow> {
  const [row] = await db
    .insert(documents)
    .values({
      entityId: input.entityId,
      uploadedById: input.uploadedById,
      name: input.name,
      storageKey: input.storageKey,
      originalName: input.originalName ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      type: input.type,
      audience: input.audience,
      retainUntil: input.retainUntil ?? null,
    })
    .returning();
  return row;
}

/** Soft delete — preserves the row + stored bytes for legal retention. */
export async function softDeleteDocument(documentId: string): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: new Date() })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
}

/** Append a download/view event to the access trail (§11 + GDPR accountability). */
export async function logDocumentAccess(
  documentId: string,
  userId: string,
  entityId: string
): Promise<void> {
  await db.insert(documentAccessLog).values({ documentId, userId, entityId });
}

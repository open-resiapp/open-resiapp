import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documents,
  documentAccessLog,
  documentProjects,
  documentLinks,
  projectComments,
  projectInterest,
  coreModules,
  posts,
  communityPosts,
  entities,
  memberships,
  users,
} from "@/db/schema";
import {
  canSeeDocPath,
  type DocumentAudience,
  type DocumentLinkTarget,
  type DocumentProjectStatus,
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
  projectId?: string | null;
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
      projectId: input.projectId ?? null,
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

// ── Document projects (dossiers) — BYT-20260608-001 ────────

export type DocumentProjectRow = typeof documentProjects.$inferSelect;
export type ProjectWithMeta = DocumentProjectRow & { documentCount: number };

export interface CreateProjectInput {
  entityId: string;
  title: string;
  description?: string | null;
  audience: DocumentAudience;
  status: DocumentProjectStatus;
  estimatedCost?: number | null;
  fundingNote?: string | null;
}

export async function createProject(
  input: CreateProjectInput
): Promise<DocumentProjectRow> {
  const [row] = await db
    .insert(documentProjects)
    .values({
      entityId: input.entityId,
      title: input.title,
      description: input.description ?? null,
      audience: input.audience,
      status: input.status,
      estimatedCost: input.estimatedCost ?? null,
      fundingNote: input.fundingNote ?? null,
    })
    .returning();
  return row;
}

export async function getProject(id: string): Promise<DocumentProjectRow | null> {
  const [row] = await db
    .select()
    .from(documentProjects)
    .where(eq(documentProjects.id, id))
    .limit(1);
  return row ?? null;
}

/** Project if the user may see it (same audience+entity rule as documents). */
export async function getViewableProject(
  userId: string,
  id: string
): Promise<DocumentProjectRow | null> {
  const [row] = await db
    .select({ project: documentProjects, path: entities.path })
    .from(documentProjects)
    .innerJoin(entities, eq(documentProjects.entityId, entities.id))
    .where(eq(documentProjects.id, id))
    .limit(1);
  if (!row) return null;
  const mems = await loadUserMemberships(userId);
  return canSeeDocPath(mems, row.path, row.project.audience) ? row.project : null;
}

/** Projects in the subtree of `scopeEntityId` the user may see, with doc counts. */
export async function listVisibleProjects(
  userId: string,
  scopeEntityId: string
): Promise<ProjectWithMeta[]> {
  const [scope] = await db
    .select({ path: entities.path })
    .from(entities)
    .where(eq(entities.id, scopeEntityId))
    .limit(1);
  if (!scope) return [];

  const rows = await db
    .select({ project: documentProjects, path: entities.path })
    .from(documentProjects)
    .innerJoin(entities, eq(documentProjects.entityId, entities.id))
    .where(sql`${entities.path} LIKE ${scope.path + "%"}`)
    .orderBy(desc(documentProjects.createdAt));

  const mems = await loadUserMemberships(userId);
  const visible = rows.filter((r) => canSeeDocPath(mems, r.path, r.project.audience));

  const ids = visible.map((r) => r.project.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const grouped = await db
      .select({ projectId: documents.projectId, c: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(inArray(documents.projectId, ids), isNull(documents.deletedAt)))
      .groupBy(documents.projectId);
    for (const g of grouped) if (g.projectId) counts.set(g.projectId, Number(g.c));
  }

  return visible.map((r) => ({
    ...r.project,
    documentCount: counts.get(r.project.id) ?? 0,
  }));
}

/** Non-deleted docs in a project the user may see. */
export async function listProjectDocuments(
  userId: string,
  projectId: string
): Promise<DocumentListItem[]> {
  const rows = await db
    .select({ doc: documents, path: entities.path, uploaderName: users.name })
    .from(documents)
    .innerJoin(entities, eq(documents.entityId, entities.id))
    .leftJoin(users, eq(documents.uploadedById, users.id))
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
  const mems = await loadUserMemberships(userId);
  return rows
    .filter((r) => canSeeDocPath(mems, r.path, r.doc.audience))
    .map((r) => ({ ...r.doc, uploaderName: r.uploaderName }));
}

export async function updateProject(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    audience?: DocumentAudience;
    status?: DocumentProjectStatus;
    estimatedCost?: number | null;
    fundingNote?: string | null;
  }
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(documentProjects).set(patch).where(eq(documentProjects.id, id));
}

export async function deleteProject(id: string): Promise<void> {
  // documents.project_id is set null via FK — docs revert to standalone.
  await db.delete(documentProjects).where(eq(documentProjects.id, id));
}

export async function assignDocumentToProject(
  documentId: string,
  projectId: string | null
): Promise<void> {
  await db.update(documents).set({ projectId }).where(eq(documents.id, documentId));
}

// ── Document attachments (links) — BYT-20260608-001 Phase B ──

/** Resolve the entity a polymorphic target belongs to (for authorization). */
export async function resolveTargetEntityId(
  targetType: DocumentLinkTarget,
  targetId: string
): Promise<string | null> {
  if (targetType === "board_post") {
    const [r] = await db
      .select({ entityId: posts.entityId })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    return r?.entityId ?? null;
  }
  const [r] = await db
    .select({ entityId: communityPosts.entityId })
    .from(communityPosts)
    .where(eq(communityPosts.id, targetId))
    .limit(1);
  return r?.entityId ?? null;
}

export async function linkDocumentToTarget(
  documentId: string,
  targetType: DocumentLinkTarget,
  targetId: string
): Promise<void> {
  await db
    .insert(documentLinks)
    .values({ documentId, targetType, targetId })
    .onConflictDoNothing();
}

export async function unlinkDocument(
  documentId: string,
  targetType: DocumentLinkTarget,
  targetId: string
): Promise<void> {
  await db
    .delete(documentLinks)
    .where(
      and(
        eq(documentLinks.documentId, documentId),
        eq(documentLinks.targetType, targetType),
        eq(documentLinks.targetId, targetId)
      )
    );
}

/** Remove all attachment links for a target — call from the target's DELETE
 *  handler (target_id has no FK, so this is not cascaded by the DB). */
export async function deleteLinksForTarget(
  targetType: DocumentLinkTarget,
  targetId: string
): Promise<void> {
  await db
    .delete(documentLinks)
    .where(
      and(
        eq(documentLinks.targetType, targetType),
        eq(documentLinks.targetId, targetId)
      )
    );
}

/** Documents attached to a target, filtered to those the user may see. */
export async function listTargetDocuments(
  userId: string,
  targetType: DocumentLinkTarget,
  targetId: string
): Promise<DocumentListItem[]> {
  const rows = await db
    .select({ doc: documents, path: entities.path, uploaderName: users.name })
    .from(documentLinks)
    .innerJoin(documents, eq(documentLinks.documentId, documents.id))
    .innerJoin(entities, eq(documents.entityId, entities.id))
    .leftJoin(users, eq(documents.uploadedById, users.id))
    .where(
      and(
        eq(documentLinks.targetType, targetType),
        eq(documentLinks.targetId, targetId),
        isNull(documents.deletedAt)
      )
    )
    .orderBy(desc(documentLinks.createdAt));
  const mems = await loadUserMemberships(userId);
  return rows
    .filter((r) => canSeeDocPath(mems, r.path, r.doc.audience))
    .map((r) => ({ ...r.doc, uploaderName: r.uploaderName }));
}

// ── Project discussion thread — BYT-20260608-001 (project workspace) ──

export type ProjectCommentRow = typeof projectComments.$inferSelect;
export interface ProjectCommentItem {
  id: string;
  content: string;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
}

/** Chronological comments on a project, with author names. */
export async function listProjectComments(
  projectId: string
): Promise<ProjectCommentItem[]> {
  const rows = await db
    .select({ c: projectComments, authorName: users.name })
    .from(projectComments)
    .leftJoin(users, eq(projectComments.authorId, users.id))
    .where(eq(projectComments.projectId, projectId))
    .orderBy(asc(projectComments.createdAt));
  return rows.map((r) => ({
    id: r.c.id,
    content: r.c.content,
    createdAt: r.c.createdAt,
    authorId: r.c.authorId,
    authorName: r.authorName,
  }));
}

export async function createProjectComment(
  projectId: string,
  authorId: string,
  content: string
): Promise<void> {
  await db.insert(projectComments).values({ projectId, authorId, content });
}

export async function getProjectComment(
  id: string
): Promise<ProjectCommentRow | null> {
  const [row] = await db
    .select()
    .from(projectComments)
    .where(eq(projectComments.id, id))
    .limit(1);
  return row ?? null;
}

export async function deleteProjectComment(id: string): Promise<void> {
  await db.delete(projectComments).where(eq(projectComments.id, id));
}

// ── Project pre-vote (anketa) — casual 👍/👎 interest reaction ──

export interface ProjectInterestSummary {
  up: number;
  down: number;
  mine: "up" | "down" | null;
}

export async function getProjectInterest(
  projectId: string,
  userId: string
): Promise<ProjectInterestSummary> {
  const rows = await db
    .select({ stance: projectInterest.stance, userId: projectInterest.userId })
    .from(projectInterest)
    .where(eq(projectInterest.projectId, projectId));
  let up = 0;
  let down = 0;
  let mine: "up" | "down" | null = null;
  for (const r of rows) {
    if (r.stance === "up") up++;
    else down++;
    if (r.userId === userId) mine = r.stance;
  }
  return { up, down, mine };
}

export async function setProjectInterest(
  projectId: string,
  userId: string,
  stance: "up" | "down"
): Promise<void> {
  await db
    .insert(projectInterest)
    .values({ projectId, userId, stance })
    .onConflictDoUpdate({
      target: [projectInterest.projectId, projectInterest.userId],
      set: { stance, updatedAt: new Date() },
    });
}

export async function clearProjectInterest(
  projectId: string,
  userId: string
): Promise<void> {
  await db
    .delete(projectInterest)
    .where(
      and(
        eq(projectInterest.projectId, projectId),
        eq(projectInterest.userId, userId)
      )
    );
}

/** True if a module is installed AND enabled (core_modules.status='enabled').
 *  Used to gate cross-module actions like "start a formal vote from a project"
 *  when the voting module may not be installed. */
export async function isModuleEnabled(name: string): Promise<boolean> {
  const [row] = await db
    .select({ name: coreModules.name })
    .from(coreModules)
    .where(and(eq(coreModules.name, name), eq(coreModules.status, "enabled")))
    .limit(1);
  return !!row;
}

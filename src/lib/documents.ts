import type { UserRole } from "@/types";

// Document library — client-safe constants, types, and the PURE visibility
// resolver. No DB / server-only imports here so client components (upload form)
// can import the taxonomy. Server DB code lives in `documents.server.ts`.
//
// BYT-20260512-006. Taxonomy grounded in §8b/§9/§11 zák. 182/1993 Z.z.

// Canonical taxonomy. MUST stay in sync with the `document_type` /
// `document_audience` pgEnums in src/db/schema.ts (same string order).
export const DOCUMENT_TYPES = [
  "statutes",
  "house_rules",
  "minutes",
  "vote_result",
  "vendor_contract",
  "works_contract",
  "insurance",
  "revision",
  "budget",
  "settlement",
  "fund_statement",
  "accounting",
  "employment",
  "technical",
  "maintenance",
  "notice",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_AUDIENCES = ["admin", "owner", "resident"] as const;
export type DocumentAudience = (typeof DOCUMENT_AUDIENCES)[number];

// Document Project (dossier) lifecycle. BYT-20260608-001. Keep in sync with the
// document_project_status pgEnum in src/db/schema.ts.
export const DOCUMENT_PROJECT_STATUSES = ["planned", "active", "done"] as const;
export type DocumentProjectStatus = (typeof DOCUMENT_PROJECT_STATUSES)[number];

// Polymorphic attachment targets. BYT-20260608-001 Phase B. Keep in sync with
// the document_link_target pgEnum in src/db/schema.ts.
export const DOCUMENT_LINK_TARGETS = ["board_post", "community_post"] as const;
export type DocumentLinkTarget = (typeof DOCUMENT_LINK_TARGETS)[number];

// Default audience per type — encodes the §11 owner-inspection mapping. The
// upload form pre-fills this; an admin may narrow within their rights.
export const DEFAULT_AUDIENCE_BY_TYPE: Record<DocumentType, DocumentAudience> = {
  statutes: "owner",
  house_rules: "resident",
  minutes: "owner",
  vote_result: "owner",
  vendor_contract: "owner",
  works_contract: "owner",
  insurance: "owner",
  revision: "owner",
  budget: "owner",
  settlement: "owner",
  fund_statement: "owner",
  accounting: "admin",
  employment: "admin",
  technical: "owner",
  maintenance: "owner",
  notice: "resident",
  other: "admin",
};

// Server-side allowlist is authoritative (route re-checks); this mirrors it for
// client UX + the file <input accept>.
export const ALLOWED_DOCUMENT_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
};
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25 MB

// Which membership roles satisfy each audience tier. Owner tier = the §11
// owner-inspection right; resident = everyone; admin = board only.
const AUDIENCE_ROLES: Record<DocumentAudience, readonly UserRole[]> = {
  admin: ["admin"],
  owner: ["admin", "owner"],
  resident: ["admin", "owner", "tenant", "vote_counter", "caretaker"],
};

export interface UserMembershipLite {
  entityPath: string;
  role: UserRole;
}

// Entity paths are trailing-slash, slash-delimited (e.g. "/root/child/").
// Two paths are "related" iff one is a prefix of the other — i.e. they sit on
// the same root-to-leaf line (ancestor / descendant / equal). The trailing
// slash makes startsWith segment-safe (no "/a/b" vs "/a/bc" false match).
function pathRelated(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Owner-folder input (BYT-20261118-005). `subjectUserId` is the person a
 * document belongs to (null = no owner folder, plain entity-anchored doc);
 * `viewerId` is the user being resolved. Projects have no subject → pass null.
 */
export interface DocSubjectInput {
  viewerId: string;
  subjectUserId: string | null;
}

/**
 * Single source of truth for document visibility. A user may see a document
 * iff they hold an active membership with a qualifying role somewhere on the
 * SAME root-to-leaf line as the document's anchor entity:
 *   - membership ABOVE the anchor    → authority from above (board / manager)
 *   - membership AT/BELOW the anchor  → the audience the doc broadcasts to
 *
 * BOTH directions are required (spec BYT-20260512-006): a building-root doc
 * with audience=owner must reach every owner below it (broadcast), and a
 * unit-level doc must still reach the board above it (authority).
 *
 * Owner folder (BYT-20261118-005):
 *   visible = board (admin on the line) — always
 *          OR ( audience != admin
 *               AND (subject IS NULL OR viewer == subject)
 *               AND audience role on the line )
 * So `audience=admin` ⇒ board only (the subject owner never sees it), and an
 * owner-folder doc never reaches co-owners or the next owner of the unit.
 * A board member who is also the subject sees it (admin role wins).
 * TODO(decision): spec Notes #2 — hide subject-self from board members?
 */
export function canSeeDocPath(
  userMemberships: UserMembershipLite[],
  docEntityPath: string,
  audience: DocumentAudience,
  // Required (no default) so every caller decides — null only for projects.
  subject: DocSubjectInput | null
): boolean {
  const onLine = (m: UserMembershipLite) => pathRelated(m.entityPath, docEntityPath);
  if (userMemberships.some((m) => m.role === "admin" && onLine(m))) return true;
  if (audience === "admin") return false;
  if (subject?.subjectUserId && subject.subjectUserId !== subject.viewerId) {
    return false;
  }
  const qualifying = AUDIENCE_ROLES[audience];
  return userMemberships.some((m) => qualifying.includes(m.role) && onLine(m));
}

/** True iff the user holds an active admin (board) membership on the doc's
 *  root-to-leaf line — the gate for visibility changes, audit trail and
 *  e-mail send (BYT-20261118-005). */
export function isBoardOnDocPath(
  userMemberships: UserMembershipLite[],
  docEntityPath: string
): boolean {
  return userMemberships.some(
    (m) => m.role === "admin" && pathRelated(m.entityPath, docEntityPath)
  );
}

// ── Error codes (BYT-20261118-005) — mapped to i18n `DocumentVisibility.errors`
export const DOCUMENT_ERROR_CODES = [
  "document.forbidden",
  "document.not_found",
  "document.audience.invalid",
  "document.subject.not_owner",
  "document.send.board_only",
  "document.send.too_large_no_account",
  "document.send.no_email",
  "document.send.no_recipient",
  "document.send.throttled",
  "document.send.failed",
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/** Attachment cap for "send by e-mail"; above it the e-mail carries a link.
 *  Spec Notes #6: 10 MB default (base64 ≈ +33 %, SMTP relays cap 10–25 MB). */
export const DOCUMENT_EMAIL_ATTACHMENT_MAX_DEFAULT = 10 * 1024 * 1024;
export const DOCUMENT_EMAIL_MESSAGE_MAX = 500;

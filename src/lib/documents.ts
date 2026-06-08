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
 * Single source of truth for document visibility. A user may see a document
 * iff they hold an active membership with a qualifying role somewhere on the
 * SAME root-to-leaf line as the document's anchor entity:
 *   - membership ABOVE the anchor    → authority from above (board / manager)
 *   - membership AT/BELOW the anchor  → the audience the doc broadcasts to
 *
 * BOTH directions are required (spec BYT-20260512-006): a building-root doc
 * with audience=owner must reach every owner below it (broadcast), and a
 * unit-level doc must still reach the board above it (authority).
 */
export function canSeeDocPath(
  userMemberships: UserMembershipLite[],
  docEntityPath: string,
  audience: DocumentAudience
): boolean {
  const qualifying = AUDIENCE_ROLES[audience];
  return userMemberships.some(
    (m) => qualifying.includes(m.role) && pathRelated(m.entityPath, docEntityPath)
  );
}

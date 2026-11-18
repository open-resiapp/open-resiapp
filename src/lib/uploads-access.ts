import { hasPermission, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Category allowlist for the raw /api/uploads route (BYT-20261118-005 G1).
//
// The local storage driver writes EVERY object under the same uploads root:
// document library files (documents/<entity>/…), accounting invoices,
// branding assets, plus the plain images this route handles. Only the
// categories below may be written by POST /api/uploads and read back by
// GET /api/uploads/[...path]; anything else (documents, accounting, branding,
// future prefixes) is unreachable through this route by construction and must
// be served by its own auth-gated proxy (e.g. GET /api/documents/[id]).

export const UPLOAD_CATEGORIES = {
  // Paper ballot photos — personal data (signature, choices). Readable by the
  // roles that record / audit paper ballots.
  // TODO(decision): should owners see the scan of their own paper ballot?
  // Today only admin / vote_counter (BoardConsole) render these.
  "paper-votes": { write: "recordPaperVote", read: "recordPaperVote" },
  // Community-board photos — any signed-in member (unchanged behaviour; they
  // surface in the feed as well as on the community board).
  "community-posts": { write: "uploadCommunityPhoto", read: null },
} as const satisfies Record<
  string,
  { write: Permission; read: Permission | null }
>;

export type UploadCategory = keyof typeof UPLOAD_CATEGORIES;

export function isUploadCategory(c: string): c is UploadCategory {
  return Object.prototype.hasOwnProperty.call(UPLOAD_CATEGORIES, c);
}

export function canWriteUploadCategory(category: string, role: UserRole): boolean {
  return isUploadCategory(category) && hasPermission(role, UPLOAD_CATEGORIES[category].write);
}

export function canReadUploadCategory(category: string, role: UserRole): boolean {
  if (!isUploadCategory(category)) return false;
  const read: Permission | null = UPLOAD_CATEGORIES[category].read;
  return read === null || hasPermission(role, read);
}

// Client-safe types for the unified Vlastníci page (BYT-20261117-002 Phase 5).
// The loader lives in `owners-board.server.ts`.

import type { UserRole } from "@/types";

/**
 * One account status per person, derived from `users` + `invitations`:
 * - `no_account`: shell record (password_hash IS NULL), no open invitation.
 * - `invited`: shell record with an open (status='pending') invitation
 *   targeting it (`invitations.target_shell_user_id`). May be past expiry.
 * - `pending`: self-registered (has password) but users.status='pending' —
 *   waits for board approval.
 * - `active`: users.status='active' with a password (can log in unless
 *   deactivated via users.is_active=false).
 */
export type OwnerStatus = "no_account" | "invited" | "pending" | "active";

export const OWNER_STATUSES: OwnerStatus[] = ["no_account", "invited", "pending", "active"];

export interface OwnerFlat {
  unitId: string;
  flatNumber: string;
  entranceName: string | null;
  floor: number | null;
  shareNum: number;
  shareDen: number;
}

export interface OwnerInvite {
  /** invitations.id — the queue fingerprint of an unfinished invitation. */
  id: string;
  sentAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface OwnerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: OwnerStatus;
  /** users.is_active = false — account exists but login is blocked. */
  deactivated: boolean;
  emailVerified: boolean;
  flats: OwnerFlat[];
  invite: OwnerInvite | null;
  createdAt: string;
  /** Shell that the merge endpoint accepts as a source (no e-mail, pending). */
  mergeable: boolean;
  /**
   * BYT-20261118-007: former owner of this community — ended memberships
   * here and no current one. ISO date of the last valid_to; null otherwise.
   */
  formerUntil?: string | null;
}

export interface InboxSuggestion {
  shellId: string;
  shellName: string;
  flatNumber: string | null;
  score: number;
}

export interface InboxItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  emailVerified: boolean;
  /** Flats already linked (e.g. merged earlier but never approved). */
  flats: OwnerFlat[];
  suggestion: InboxSuggestion | null;
}

export interface UnitOwnerShare {
  userId: string;
  name: string;
  shareNum: number;
  shareDen: number;
}

export interface UnitOption {
  id: string;
  flatNumber: string;
  entranceName: string | null;
  owners: UnitOwnerShare[];
}

/** A shell that a registrant can be merged into (or vice versa). */
export interface MergeShellOption {
  id: string;
  name: string;
  flatNumber: string | null;
}

/** A pending self-registrant that a shell can be merged into. */
export interface MergeCandidate {
  id: string;
  name: string;
  email: string;
}

export interface OwnersBoardData {
  people: OwnerRow[];
  inbox: InboxItem[];
  units: UnitOption[];
  mergeShells: MergeShellOption[];
  mergeCandidates: MergeCandidate[];
}

export interface OwnerDetailData {
  owner: OwnerRow;
  units: UnitOption[];
  mergeCandidates: MergeCandidate[];
  /**
   * BYT-20261118-003: users.last_login_at (ISO) — only in this board-only
   * payload (owner detail is gated by manageUsers). Null = no sign-in recorded.
   */
  lastLoginAt: string | null;
}

export type CreateOwnerErrorCode =
  | "forbidden"
  | "name_required"
  | "invalid_email"
  | "email_taken"
  | "unit_required"
  | "unit_not_found"
  | "invalid_share"
  | "invalid_role"
  | "failed";

export type RevokeInviteErrorCode = "forbidden" | "not_found" | "failed";

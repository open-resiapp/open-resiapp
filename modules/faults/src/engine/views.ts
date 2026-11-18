// View shapes + field filters (BYT-20261118-004 "Server-side visibility").
// PURE. The resident view is built from an explicit SQL column list in
// queries.server.ts; `toResidentView` then maps it onto EXACTLY the keys
// below — nothing board-only can slip through a spread.

import type { FaultPriority, FaultStatus, FaultVisibility } from "./transitions";

export const RESIDENT_VIEW_KEYS = [
  "id",
  "title",
  "description",
  "status",
  "locationLabel",
  "locationNote",
  "visibility",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "isMine",
  "photos",
  "publicEvents",
] as const;

export interface FaultPublicEvent {
  status: FaultStatus | null;
  message: string | null;
  createdAt: string;
}

export interface FaultResidentView {
  id: string;
  title: string;
  description: string | null;
  status: FaultStatus;
  locationLabel: string;
  locationNote: string | null;
  visibility: FaultVisibility;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  isMine: boolean;
  photos: { id: string }[];
  publicEvents: FaultPublicEvent[];
}

/** Row the resident SQL select returns (explicit columns only). */
export interface ResidentRow {
  id: string;
  title: string;
  description: string | null;
  status: FaultStatus;
  locationLabel: string;
  locationNote: string | null;
  visibility: FaultVisibility;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  isMine: boolean;
}

export function toResidentView(
  row: ResidentRow,
  photos: { id: string }[],
  publicEvents: FaultPublicEvent[]
): FaultResidentView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    locationLabel: row.locationLabel,
    locationNote: row.locationNote,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    isMine: row.isMine,
    photos: photos.map((p) => ({ id: p.id })),
    publicEvents: publicEvents.map((e) => ({
      status: e.status,
      message: e.message,
      createdAt: e.createdAt,
    })),
  };
}

/** Board access level. `caretaker` = sees + works the task, but not the
 *  internal note, invoiced flag or expense link (decided 2026-11-18). */
export type FaultBoardAccess = "full" | "caretaker";

/** Fields only `full` board access may read or change. */
export const FULL_ONLY_FIELDS = ["internalNote", "invoiced", "expenseId"] as const;

export interface FaultBoardEvent {
  id: string;
  type: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  publicMessage: string | null;
  isPublic: boolean;
  actorName: string | null;
  createdAt: string;
}

export interface FaultBoardView {
  id: string;
  title: string;
  description: string | null;
  status: FaultStatus;
  priority: FaultPriority;
  visibility: FaultVisibility;
  locationEntityId: string;
  locationLabel: string;
  locationNote: string | null;
  reporterId: string | null;
  reporterName: string | null;
  categoryId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  contractorId: string | null;
  contractorName: string | null;
  /** null for caretaker access. */
  invoiced: boolean | null;
  expenseId: string | null;
  internalNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  boardTouched: boolean;
  photos: { id: string }[];
  events: FaultBoardEvent[];
}

/** Events a caretaker must not see (changes of full-only fields). */
export function isFullOnlyEvent(field: string | null): boolean {
  return field !== null && (FULL_ONLY_FIELDS as readonly string[]).includes(field);
}

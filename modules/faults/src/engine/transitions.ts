// Fault lifecycle + rule engine (BYT-20261118-004). PURE: no DB, no i18n,
// no server-only imports — safe for client components and tsx checks.
// Every failure is a stable error CODE; the API / UI maps it to
// `Faults.errors.<code>` in messages/{sk,en,cs}.json.

export const FAULT_STATUSES = ["new", "in_progress", "resolved", "rejected", "withdrawn"] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number];

export const FAULT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FaultPriority = (typeof FAULT_PRIORITIES)[number];

/** Ordered narrowest → widest. */
export const FAULT_VISIBILITIES = ["private", "entrance", "community"] as const;
export type FaultVisibility = (typeof FAULT_VISIBILITIES)[number];

/** Statuses the board works on (open). */
export const OPEN_STATUSES: readonly FaultStatus[] = ["new", "in_progress"];

export const FAULT_ERROR_CODES = [
  "FAULT_INVALID_TRANSITION",
  "FAULT_REASON_REQUIRED",
  "FAULT_NOT_EDITABLE",
  "FAULT_WITHDRAW_NOT_ALLOWED",
  "FAULT_LOCATION_NOT_ALLOWED",
  "FAULT_VISIBILITY_WIDEN_FORBIDDEN",
  "FAULT_TOO_MANY_PHOTOS",
  "FAULT_PHOTO_INVALID",
  "FAULT_ASSIGNEE_CONFLICT",
  "FAULT_EXPENSE_NOT_FOUND",
  "FAULT_TITLE_REQUIRED",
  "FAULT_NOT_FOUND",
  "FAULT_FORBIDDEN",
  "FAULT_INVALID_INPUT",
] as const;
export type FaultErrorCode = (typeof FAULT_ERROR_CODES)[number];

export type EngineResult = { ok: true } | { ok: false; code: FaultErrorCode };

const OK: EngineResult = { ok: true };
const fail = (code: FaultErrorCode): EngineResult => ({ ok: false, code });

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const TITLE_MAX = 120;
export const STALE_DAYS = 30;

/**
 * Board transitions (spec table). `withdrawn` is reporter-only and
 * terminal; it is reached through `canWithdraw`, never through here.
 */
const BOARD_TRANSITIONS: Record<FaultStatus, readonly FaultStatus[]> = {
  new: ["in_progress", "resolved", "rejected"],
  in_progress: ["resolved", "rejected", "new"],
  resolved: ["in_progress"],
  rejected: ["new"],
  withdrawn: [],
};

/** Transitions that must carry a public message (reason). */
function reasonRequired(from: FaultStatus, to: FaultStatus): boolean {
  if (to === "rejected") return true;
  if (from === "resolved" && to === "in_progress") return true;
  return false;
}

export function allowedBoardTargets(from: FaultStatus): readonly FaultStatus[] {
  return BOARD_TRANSITIONS[from];
}

export function needsReason(from: FaultStatus, to: FaultStatus): boolean {
  return reasonRequired(from, to);
}

export function checkBoardTransition(
  from: FaultStatus,
  to: FaultStatus,
  publicMessage: string | null | undefined
): EngineResult {
  if (!BOARD_TRANSITIONS[from].includes(to)) return fail("FAULT_INVALID_TRANSITION");
  if (reasonRequired(from, to) && !(publicMessage ?? "").trim()) {
    return fail("FAULT_REASON_REQUIRED");
  }
  return OK;
}

/** Reporter edit (title / description / photos / location note). */
export function checkReporterEdit(fault: {
  status: FaultStatus;
  boardTouched: boolean;
}): EngineResult {
  if (fault.status !== "new" || fault.boardTouched) return fail("FAULT_NOT_EDITABLE");
  return OK;
}

/** Reporter withdraw: only while `new` and before any board change. */
export function checkWithdraw(fault: { status: FaultStatus; boardTouched: boolean }): EngineResult {
  if (fault.status !== "new" || fault.boardTouched) return fail("FAULT_WITHDRAW_NOT_ALLOWED");
  return OK;
}

export function checkAssignee(input: {
  assigneeUserId: string | null;
  contractorId: string | null;
}): EngineResult {
  if (input.assigneeUserId && input.contractorId) return fail("FAULT_ASSIGNEE_CONFLICT");
  return OK;
}

export function checkPhotoCount(existing: number, adding: number): EngineResult {
  if (existing + adding > MAX_PHOTOS) return fail("FAULT_TOO_MANY_PHOTOS");
  return OK;
}

export function checkPhoto(file: { type: string; size: number }): EngineResult {
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return fail("FAULT_PHOTO_INVALID");
  }
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) return fail("FAULT_PHOTO_INVALID");
  return OK;
}

export function checkTitle(title: string | null | undefined): EngineResult {
  const t = (title ?? "").trim();
  if (!t) return fail("FAULT_TITLE_REQUIRED");
  if (t.length > TITLE_MAX) return fail("FAULT_INVALID_INPUT");
  return OK;
}

// ── Location + visibility ──────────────────────────────

/** Location kinds as the reporter sees them. */
export type LocationKind = "unit" | "group" | "root";

export function defaultVisibility(kind: LocationKind): FaultVisibility {
  if (kind === "unit") return "private";
  if (kind === "group") return "entrance";
  return "community";
}

export function visibilityRank(v: FaultVisibility): number {
  return FAULT_VISIBILITIES.indexOf(v);
}

/** Reporter may keep the default or narrow it; never widen. */
export function checkReporterVisibility(
  kind: LocationKind,
  requested: FaultVisibility | null | undefined
): { ok: true; visibility: FaultVisibility } | { ok: false; code: FaultErrorCode } {
  const def = defaultVisibility(kind);
  const v = requested ?? def;
  if (!(FAULT_VISIBILITIES as readonly string[]).includes(v)) {
    return { ok: false, code: "FAULT_INVALID_INPUT" };
  }
  if (visibilityRank(v) > visibilityRank(def)) {
    return { ok: false, code: "FAULT_VISIBILITY_WIDEN_FORBIDDEN" };
  }
  return { ok: true, visibility: v };
}

export function checkLocationAllowed(
  locationEntityId: string,
  allowedIds: readonly string[]
): EngineResult {
  if (!allowedIds.includes(locationEntityId)) return fail("FAULT_LOCATION_NOT_ALLOWED");
  return OK;
}

export function isFaultErrorCode(x: unknown): x is FaultErrorCode {
  return typeof x === "string" && (FAULT_ERROR_CODES as readonly string[]).includes(x);
}

/** Whole days between two instants (floor). */
export function daysOpen(createdAt: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
}

/** ISO-8601 week label, e.g. "2026-W47" (stale-digest claim key). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

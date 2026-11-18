// Board list filters (BYT-20261118-004 "Board list"). PURE + client-safe.
// URL search params are the source of truth; cookie `faults_filters`
// (same JSON shape) restores them when /poruchy opens with no params.

import {
  FAULT_PRIORITIES,
  FAULT_STATUSES,
  type FaultPriority,
  type FaultStatus,
} from "./transitions";

export const FILTER_COOKIE = "faults_filters";

export interface FaultFilters {
  status: FaultStatus[];
  priority: FaultPriority | null;
  categoryId: string | null;
  /** user id, `c:<contractorId>`, or `none`. */
  assignee: string | null;
  stale: boolean;
}

export const EMPTY_FILTERS: FaultFilters = {
  status: [],
  priority: null,
  categoryId: null,
  assignee: null,
  stale: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function cleanAssignee(v: string | undefined): string | null {
  if (!v) return null;
  if (v === "none") return "none";
  if (v.startsWith("c:") && UUID_RE.test(v.slice(2))) return v;
  if (UUID_RE.test(v)) return v;
  return null;
}

/** Parse from URL search params (`stav`, `priorita`, `kategoria`, `riesi`, `stare`). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): FaultFilters {
  const rawStatus = one(sp.stav);
  const status = (rawStatus ? rawStatus.split(",") : []).filter((s): s is FaultStatus =>
    (FAULT_STATUSES as readonly string[]).includes(s)
  );
  const p = one(sp.priorita);
  const priority =
    p && (FAULT_PRIORITIES as readonly string[]).includes(p) ? (p as FaultPriority) : null;
  const c = one(sp.kategoria);
  return {
    status: [...new Set(status)],
    priority,
    categoryId: c && UUID_RE.test(c) ? c : null,
    assignee: cleanAssignee(one(sp.riesi)),
    stale: one(sp.stare) === "1",
  };
}

export function hasAnyFilterParam(sp: Record<string, string | string[] | undefined>): boolean {
  return ["stav", "priorita", "kategoria", "riesi", "stare"].some((k) => sp[k] !== undefined);
}

export function isEmptyFilters(f: FaultFilters): boolean {
  return (
    f.status.length === 0 && !f.priority && !f.categoryId && !f.assignee && !f.stale
  );
}

export function filtersToParams(f: FaultFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status.length) out.stav = f.status.join(",");
  if (f.priority) out.priorita = f.priority;
  if (f.categoryId) out.kategoria = f.categoryId;
  if (f.assignee) out.riesi = f.assignee;
  if (f.stale) out.stare = "1";
  return out;
}

/** Parse the cookie value (JSON of the params map); bad input → empty. */
export function parseFilterCookie(raw: string | undefined): FaultFilters {
  if (!raw) return EMPTY_FILTERS;
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!obj || typeof obj !== "object") return EMPTY_FILTERS;
    return parseFilters(obj as Record<string, string>);
  } catch {
    return EMPTY_FILTERS;
  }
}

export function serializeFilterCookie(f: FaultFilters): string {
  return encodeURIComponent(JSON.stringify(filtersToParams(f)));
}

// Reading rounds — pure, client-safe helpers (BYT-20261118-006).
// Error codes, month-range expand/collapse, milli-unit parsing and the
// CSV/XLSX formula-injection guard. No server deps: the owner section and
// the board table import these directly.

export type MeterType = "heat" | "water_cold" | "water_hot" | "electricity";

export const ROUND_METER_TYPES: MeterType[] = [
  "heat",
  "water_cold",
  "water_hot",
  "electricity",
];

/** Stable error codes; the UI maps each to `ReadingRounds.errors.<code>`. */
export const READING_ERROR_CODES = [
  "period_locked",
  "round_not_open",
  "round_closed_for_owner",
  "round_exists",
  "round_invalid",
  "submission_locked",
  "already_submitted",
  "month_range_invalid",
  "month_range_overlap",
  "persons_invalid",
  "value_negative",
  "value_invalid",
  "date_in_future",
  "date_outside_round",
  "meter_type_not_collected",
  "label_required",
  "unknown_unit",
  "forbidden",
  "photo_too_large",
  "photo_type_invalid",
  "not_found",
  "already_voided",
] as const;

export type ReadingErrorCode = (typeof READING_ERROR_CODES)[number];

export class ReadingError extends Error {
  readonly code: ReadingErrorCode;
  constructor(code: ReadingErrorCode) {
    super(code);
    this.name = "ReadingError";
    this.code = code;
  }
}

export function isReadingError(err: unknown): err is ReadingError {
  return err instanceof ReadingError;
}

export function isReadingErrorCode(v: unknown): v is ReadingErrorCode {
  return (
    typeof v === "string" &&
    (READING_ERROR_CODES as readonly string[]).includes(v)
  );
}

export function readingErrorStatus(code: ReadingErrorCode): number {
  if (code === "forbidden") return 403;
  if (code === "not_found" || code === "unknown_unit") return 404;
  if (
    code === "period_locked" ||
    code === "submission_locked" ||
    code === "round_closed_for_owner" ||
    code === "round_not_open" ||
    code === "already_voided" ||
    code === "already_submitted" ||
    code === "round_exists"
  ) {
    return 409;
  }
  if (code === "photo_too_large") return 413;
  return 400;
}

// ── Person-month ranges ────────────────────────────────

export interface PersonRange {
  /** 1..12 inclusive. */
  from: number;
  /** 1..12 inclusive, >= from. */
  to: number;
  persons: number;
}

export const MAX_PERSONS = 50;

/** Null when valid; otherwise the error code to show. */
export function validatePersonRanges(
  ranges: PersonRange[]
): ReadingErrorCode | null {
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > 12) {
    return "month_range_invalid";
  }
  const seen = new Set<number>();
  for (const r of ranges) {
    if (
      !Number.isInteger(r.from) ||
      !Number.isInteger(r.to) ||
      r.from < 1 ||
      r.to > 12 ||
      r.from > r.to
    ) {
      return "month_range_invalid";
    }
    if (
      !Number.isInteger(r.persons) ||
      r.persons < 0 ||
      r.persons > MAX_PERSONS
    ) {
      return "persons_invalid";
    }
    for (let m = r.from; m <= r.to; m++) {
      if (seen.has(m)) return "month_range_overlap";
      seen.add(m);
    }
  }
  return null;
}

/** Ranges → one entry per month (caller validated first). */
export function expandPersonRanges(
  ranges: PersonRange[]
): { month: number; persons: number }[] {
  const out: { month: number; persons: number }[] = [];
  for (const r of ranges) {
    for (let m = r.from; m <= r.to; m++) out.push({ month: m, persons: r.persons });
  }
  return out.sort((a, b) => a.month - b.month);
}

/** Months → ranges, merging consecutive months with an equal count. */
export function collapsePersonMonths(
  rows: { month: number; persons: number }[]
): PersonRange[] {
  const sorted = [...rows].sort((a, b) => a.month - b.month);
  const out: PersonRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.to === r.month - 1 && last.persons === r.persons) {
      last.to = r.month;
    } else {
      out.push({ from: r.month, to: r.month, persons: r.persons });
    }
  }
  return out;
}

// ── Values ─────────────────────────────────────────────

/** "123,456" | "123.4" → thousandths; null on garbage or negative. */
export function parseMilli(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const v = parseInt(whole, 10) * 1000 + parseInt(frac.padEnd(3, "0") || "0", 10);
  return Number.isSafeInteger(v) ? v : null;
}

export function milliToDisplay(milli: number, locale = "sk-SK"): string {
  return (milli / 1000).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

// ── Export ─────────────────────────────────────────────

/**
 * CSV / formula-injection guard: a cell starting with = + - @ (or a
 * tab / CR that some spreadsheets strip first) is prefixed with `'` so it
 * is shown as text, never evaluated.
 */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// ── Owner-facing shapes ────────────────────────────────

/**
 * One owner-visible entry. EXACTLY these keys (spec AC "only-X"): the
 * board-internal resolved state, resolver and applied-persons link are
 * never part of it — `canEdit` is the only lock signal.
 */
export interface OwnerReadingEntry {
  id: string;
  kind: "persons" | MeterType;
  months: PersonRange[] | null;
  value: number | null;
  readingDate: string | null;
  /** Auth-checked photo URL, or null. */
  photo: string | null;
  late: boolean;
  canEdit: boolean;
  createdAt: string;
}

export const OWNER_ENTRY_KEYS: readonly (keyof OwnerReadingEntry)[] = [
  "id",
  "kind",
  "months",
  "value",
  "readingDate",
  "photo",
  "late",
  "canEdit",
  "createdAt",
];

export interface OwnerRoundInfo {
  id: string;
  year: number;
  opensAt: string;
  deadlineAt: string;
  collectPersons: boolean;
  meterTypes: MeterType[];
  /** Owner may submit right now (open, not closed, deadline/late ok, year not locked). */
  acceptsInput: boolean;
  /** Submitting now would be flagged late. */
  late: boolean;
}

export interface OwnerReadingsView {
  /** Open round for the owner, or null (section shows the summary only). */
  round: OwnerRoundInfo | null;
  /** The open round's entries for the unit (non-voided). */
  entries: OwnerReadingEntry[];
  /** Last known value per meter type (hint + lower-value warning). */
  lastKnown: Partial<Record<MeterType, { value: number; readingDate: string }>>;
  /** Newest submission ever for the unit — the closed-state summary. */
  lastSubmissionAt: string | null;
}

export function readingPhotoUrl(kind: "unit" | "building", id: string): string {
  return `/api/accounting/readings/photo/${kind}/${id}`;
}

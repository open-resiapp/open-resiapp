// BYT-20261118-002 §3 — statutory lead time of a voting announcement.
// Pure (no DB, no i18n): returns stable codes, the UI maps them to
// VotingWorkflow.errors.*.
//
// SK §14a ods. 2 zák. 182/1993: date, place and questions must be notified
// at least 7 days ahead. DECIDED (Filip, 2026-11-18): 7 FULL days between
// the notice day and the event day — notice on day D ⇒ meeting / start of
// the written voting earliest on D+8 (OZ §122 ods. 1: a day-based period
// starts the day after the event). Days are civil days in the community's
// time zone.
//
// E-votes are accepted from the announcement (§14a ods. 5) — the cast path
// never checks `startsAt`, only status + `endsAt`.
//
// CZ: no lead time asserted here; the per-rollam 15-day minimum duration
// (rules/index.ts) keeps guarding CZ. TODO(decision): CZ notice rule after
// legal sign-off (spec Decisions 8).
import type { Country } from "@/types";

export type NoticeErrorCode =
  | "NOTICE_LEAD_TIME_TOO_SHORT"
  | "NOTICE_START_AFTER_END";

export interface NoticeError {
  code: NoticeErrorCode;
  /** Earliest allowed start day, YYYY-MM-DD in the community time zone. */
  minDate?: string;
}

/** Full days that must separate the notice day from the event day. */
export const NOTICE_LEAD_DAYS: Record<Country, number | null> = {
  sk: 7,
  cz: null,
};

/** Civil date (YYYY-MM-DD) of an instant in a time zone. */
export function civilDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** YYYY-MM-DD + n days (calendar arithmetic, no time zone involved). */
export function addCivilDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Earliest civil day the meeting / written voting may start when the
 * announcement is made at `announcedAt`, or null when the country asserts
 * no lead time.
 */
export function minStartDate(
  country: Country,
  announcedAt: Date,
  timeZone: string
): string | null {
  const lead = NOTICE_LEAD_DAYS[country];
  if (lead === null || lead === undefined) return null;
  return addCivilDays(civilDate(announcedAt, timeZone), lead + 1);
}

/**
 * Validates the notice of a voting announced at `announcedAt`. Returns
 * null when valid.
 */
export function validateNotice(input: {
  country: Country;
  announcedAt: Date;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}): NoticeError | null {
  const min = minStartDate(input.country, input.announcedAt, input.timeZone);
  if (min && civilDate(input.startsAt, input.timeZone) < min) {
    return { code: "NOTICE_LEAD_TIME_TOO_SHORT", minDate: min };
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return { code: "NOTICE_START_AFTER_END" };
  }
  return null;
}

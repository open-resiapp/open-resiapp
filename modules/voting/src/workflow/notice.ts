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
//
// BYT-20261118-020 — bytové družstvo (regime "cooperative"):
//   SK Obch. zák. 513/1991 §239 ods. 2: "Zvolanie členskej schôdze sa musí
//      členom oznámiť spôsobom určeným stanovami" — the statute fixes NO
//      lead time; it comes from the stanovy (community setting
//      `notice_lead_days`, seeded from the template default on bootstrap).
//   CZ zák. 90/2012 §636 ods. 1: "Svolavatel nejméně 15 dnů přede dnem
//      konání členské schůze uveřejní pozvánku…" — statutory minimum 15,
//      stanovy may only lengthen it. Counted like SK HOA (full days between
//      notice day and meeting day). TODO(legal-signoff): CZ day counting.
// Effective lead = max(statutory minimum, stanovy setting); either may be
// absent. HOA behaviour is unchanged when no rules are passed.
import { legalRegimeFor, type LegalRegime } from "@/lib/legal-copy/regime";
import type { Country } from "@/types";

export type NoticeErrorCode =
  | "NOTICE_LEAD_TIME_TOO_SHORT"
  | "NOTICE_START_AFTER_END";

/** Codes for validating the stanovy lead-time SETTING (settings UI / API). */
export type NoticeSettingErrorCode =
  | "NOTICE_LEAD_SETTING_INVALID"
  | "NOTICE_LEAD_SETTING_BELOW_STATUTORY";

export interface NoticeError {
  code: NoticeErrorCode;
  /** Earliest allowed start day, YYYY-MM-DD in the community time zone. */
  minDate?: string;
}

/**
 * Statutory minimum full days between the notice day and the event day,
 * per legal regime and country. null = the statute fixes none.
 */
export const STATUTORY_LEAD_DAYS: Record<LegalRegime, Record<Country, number | null>> = {
  hoa: { sk: 7, cz: null }, // §14a ods. 2 zák. 182/1993
  cooperative: { sk: null, cz: 15 }, // SK §239 ods. 2 Obch. zák. (stanovy); CZ §636 ZOK
  other: { sk: null, cz: null },
};

/** Full days that must separate the notice day from the event day (HOA). */
export const NOTICE_LEAD_DAYS: Record<Country, number | null> = STATUTORY_LEAD_DAYS.hoa;

/** Upper bound for the stanovy setting — guards typos (e.g. 150 for 15). */
export const MAX_CONFIGURED_LEAD_DAYS = 90;

export interface NoticeRules {
  /** Defaults to "hoa" — the behaviour before regimes existed. */
  regime?: LegalRegime;
  /** Stanovy lead time stored on the community root (`notice_lead_days`). */
  configuredLeadDays?: number | null;
}

/**
 * NoticeRules of the community root (getCommunityRoot): regime from the
 * template slug, stanovy lead time from `notice_lead_days`. A missing root
 * yields HOA rules (= behaviour before regimes existed).
 */
export function noticeRulesFor(
  root: { templateSlug?: string | null; noticeLeadDays?: number | null } | null | undefined
): NoticeRules {
  return {
    regime: legalRegimeFor(root?.templateSlug ?? null),
    configuredLeadDays: root?.noticeLeadDays ?? null,
  };
}

function validConfigured(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_CONFIGURED_LEAD_DAYS
    ? v
    : null;
}

/**
 * Lead time actually enforced: the larger of the statutory minimum and the
 * stanovy setting; null when neither applies.
 */
export function effectiveLeadDays(country: Country, rules?: NoticeRules): number | null {
  const statutory = STATUTORY_LEAD_DAYS[rules?.regime ?? "hoa"][country] ?? null;
  const configured = validConfigured(rules?.configuredLeadDays);
  if (statutory === null) return configured;
  if (configured === null) return statutory;
  return Math.max(statutory, configured);
}

/**
 * Validates a stanovy lead-time value before it is stored. null / undefined
 * (= "use the statutory minimum only") is always valid.
 */
export function validateNoticeLeadSetting(
  country: Country,
  regime: LegalRegime,
  days: number | null | undefined
): { code: NoticeSettingErrorCode; minDays?: number } | null {
  if (days === null || days === undefined) return null;
  if (validConfigured(days) === null) return { code: "NOTICE_LEAD_SETTING_INVALID" };
  const statutory = STATUTORY_LEAD_DAYS[regime][country];
  if (statutory !== null && days < statutory) {
    return { code: "NOTICE_LEAD_SETTING_BELOW_STATUTORY", minDays: statutory };
  }
  return null;
}

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
  timeZone: string,
  rules?: NoticeRules
): string | null {
  const lead = effectiveLeadDays(country, rules);
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
  /** BYT-20261118-020 — omitted = SK/CZ HOA behaviour (unchanged). */
  rules?: NoticeRules;
}): NoticeError | null {
  const min = minStartDate(input.country, input.announcedAt, input.timeZone, input.rules);
  if (min && civilDate(input.startsAt, input.timeZone) < min) {
    return { code: "NOTICE_LEAD_TIME_TOO_SHORT", minDate: min };
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return { code: "NOTICE_START_AFTER_END" };
  }
  return null;
}

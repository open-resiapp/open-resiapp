// BYT-20261118-001 — owners' meeting: RSVP overview, attendance list
// (prezenčná listina), export rows and the minutes hand-off. Pure: no DB,
// no i18n. Errors are stable codes; the UI maps them to
// MeetingAttendance.errors.*.
//
// Legal anchors (SK 182/1993): one vote per flat (§14 ods. 3); a proxy needs
// a paper PoA with certified signature shown at the start (§14 ods. 4) — we
// only accept a VERIFIED mandate row; the ORIGINAL prezenčná listina is a
// minutes attachment (§14a ods. 8) — the export is the sheet to be signed;
// §14b ods. 4 decisions are measured against owners present.
//
// TODO(legal): the engine still counts "present" for simple_present as the
// weight of CAST ballots (engine/index.ts, untouched by this spec). The
// attendance numbers below are shown NEXT TO the result, never fed into it.
// Using the attendance list as the §14b ods. 4 denominator needs sign-off.
import type { QuorumType, VoteWithOwnership } from "@/types";
import type { CanonicalVotingMethod } from "@/lib/voting-method";
import { calculateResults } from "../engine";
import type { Country } from "../rules";

export type AttendanceErrorCode =
  | "ATTENDANCE_NOT_MEETING"
  | "ATTENDANCE_NOT_OPEN"
  | "ATTENDANCE_LOCKED"
  | "ATTENDANCE_NOT_ELIGIBLE"
  | "ATTENDANCE_MANDATE_REQUIRED"
  | "ATTENDANCE_ALREADY_RECORDED"
  | "ATTENDANCE_NOT_FOUND"
  | "ATTENDANCE_HAS_BALLOT";

export type MeetingRsvpErrorCode =
  | "MEETING_RSVP_NOT_ELIGIBLE"
  | "MEETING_RSVP_CLOSED"
  | "MEETING_RSVP_TOKEN_INVALID"
  | "MEETING_RSVP_TOKEN_EXPIRED";

export type MeetingErrorCode =
  | "MEETING_NOT_MEETING_VOTING"
  | "MEETING_NOT_ANNOUNCED"
  | "MEETING_ALREADY_ANNOUNCED"
  | "MEETING_VOTING_NOT_ACTIVE"
  | "MEETING_IN_PAST"
  | "MEETING_PLACE_REQUIRED"
  | "MEETING_NOTICE_TOO_SHORT"
  | "MEETING_EXPORT_UNAVAILABLE";

/** The door list opens this long before the meeting starts. */
export const ATTENDANCE_OPENS_BEFORE_MS = 2 * 60 * 60 * 1000;

export type RsvpStatus = "yes" | "no" | "maybe";
export type RsvpSource = "app" | "email_link" | "board";
export type AttendanceStatus = "present" | "represented";
/** Derived per-owner state; `absent` only once the voting is closed. */
export type AttendanceState = AttendanceStatus | "absent" | "not_recorded";

/**
 * May the attendance list be written now? Opens 2 h before `startsAt`,
 * freezes when the voting is closed (editable again only while a closed
 * voting is reopened — status goes back to active).
 */
export function attendanceWriteError(
  voting: { votingType: string; status: string; startsAt: Date },
  now: Date
): AttendanceErrorCode | null {
  if (voting.votingType !== "meeting") return "ATTENDANCE_NOT_MEETING";
  if (voting.status === "closed") return "ATTENDANCE_LOCKED";
  if (voting.status !== "active") return "ATTENDANCE_NOT_OPEN";
  if (now.getTime() < voting.startsAt.getTime() - ATTENDANCE_OPENS_BEFORE_MS) {
    return "ATTENDANCE_NOT_OPEN";
  }
  return null;
}

/** RSVP to a meeting post is accepted until the meeting starts. */
export function meetingRsvpWriteError(
  post: { status: string; eventDate: Date | null },
  now: Date
): MeetingRsvpErrorCode | null {
  if (post.status !== "active") return "MEETING_RSVP_CLOSED";
  if (post.eventDate && now.getTime() >= post.eventDate.getTime()) return "MEETING_RSVP_CLOSED";
  return null;
}

// ── Shared input shapes ────────────────────────────────

/** One eligible (unit, owner) — same rows and weights as getVotingParticipation. */
export interface EligibleLine {
  unitId: string;
  unitLabel: string;
  ownerId: string;
  ownerName: string | null;
  weight: number;
  unitShareNumerator: number | null;
  unitShareDenominator: number | null;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  area?: number | null;
  membershipWeight?: number;
}

export interface AttendanceRowIn {
  id: string;
  ownerId: string;
  status: AttendanceStatus;
  representativeName: string | null;
  mandateId: string | null;
  checkedInAt: Date | string;
  leftAt: Date | string | null;
}

interface OwnerAgg {
  ownerId: string;
  ownerName: string | null;
  units: { unitId: string; unitLabel: string; weight: number }[];
  weight: number;
}

function byOwner(eligible: EligibleLine[]): OwnerAgg[] {
  const map = new Map<string, OwnerAgg>();
  for (const e of eligible) {
    const o = map.get(e.ownerId) ?? {
      ownerId: e.ownerId,
      ownerName: e.ownerName,
      units: [],
      weight: 0,
    };
    o.units.push({ unitId: e.unitId, unitLabel: e.unitLabel, weight: e.weight });
    o.weight += e.weight;
    map.set(e.ownerId, o);
  }
  const collator = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return [...map.values()].sort((a, b) =>
    collator(a.units[0]?.unitLabel ?? "", b.units[0]?.unitLabel ?? "")
  );
}

const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === "string" ? d : d.toISOString();

// ── RSVP overview (§5) ─────────────────────────────────

export interface RsvpOwnerLine {
  ownerId: string;
  ownerName: string | null;
  unitLabels: string[];
  weight: number;
  rsvp: RsvpStatus | null;
  source: RsvpSource | null;
  invited: boolean;
  hasEmail: boolean;
}

export type QuorumEstimateCode = "REACHABLE" | "NOT_REACHABLE" | "MEASURED_AGAINST_PRESENT";

export interface RsvpOverview {
  eligibleOwners: number;
  eligibleWeight: number;
  totals: Record<RsvpStatus | "none", { owners: number; weight: number }>;
  owners: RsvpOwnerLine[];
  items: { itemId: string; idx: number; title: string; quorumType: QuorumType; estimate: QuorumEstimateCode }[];
}

/**
 * Board overview of planned attendance. `maybe` is never counted as half and
 * never added to the expected share. The per-item estimate asks the ENGINE
 * whether the owners who said "yes", all voting for, would pass the item —
 * thresholds are not re-implemented here. Informative only.
 */
export function buildRsvpOverview(input: {
  eligible: EligibleLine[];
  rsvps: Map<string, { status: RsvpStatus; source: RsvpSource }>;
  invited: Set<string>;
  withEmail: Set<string>;
  items: { id: string; idx: number; title: string; quorumType: QuorumType }[];
  votingMethod: CanonicalVotingMethod;
  country: Country;
}): RsvpOverview {
  const owners = byOwner(input.eligible);
  const totals: RsvpOverview["totals"] = {
    yes: { owners: 0, weight: 0 },
    no: { owners: 0, weight: 0 },
    maybe: { owners: 0, weight: 0 },
    none: { owners: 0, weight: 0 },
  };
  let eligibleWeight = 0;
  const lines: RsvpOwnerLine[] = owners.map((o) => {
    const r = input.rsvps.get(o.ownerId) ?? null;
    const bucket = totals[r?.status ?? "none"];
    bucket.owners += 1;
    bucket.weight += o.weight;
    eligibleWeight += o.weight;
    return {
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      unitLabels: o.units.map((u) => u.unitLabel),
      weight: o.weight,
      rsvp: r?.status ?? null,
      source: r?.source ?? null,
      invited: input.invited.has(o.ownerId),
      hasEmail: input.withEmail.has(o.ownerId),
    };
  });

  const yesVotes: VoteWithOwnership[] = input.eligible
    .filter((e) => input.rsvps.get(e.ownerId)?.status === "yes")
    .map((e) => ({
      unitEntityId: e.unitId,
      userId: e.ownerId,
      userName: null,
      choice: "za",
      unitShareNumerator: e.unitShareNumerator ?? 0,
      unitShareDenominator: e.unitShareDenominator || 1,
      area: e.area ?? null,
      ownerUnitShareNumerator: e.ownerUnitShareNumerator,
      ownerUnitShareDenominator: e.ownerUnitShareDenominator || 1,
      membershipWeight: e.membershipWeight ?? 1,
    }));

  const items = [...input.items]
    .sort((a, b) => a.idx - b.idx)
    .map((it) => {
      let estimate: QuorumEstimateCode;
      if (it.quorumType === "simple_present") {
        estimate = "MEASURED_AGAINST_PRESENT";
      } else {
        const r = calculateResults(yesVotes, input.votingMethod, it.quorumType, eligibleWeight, {
          country: input.country,
        });
        estimate = r.passed ? "REACHABLE" : "NOT_REACHABLE";
      }
      return { itemId: it.id, idx: it.idx, title: it.title, quorumType: it.quorumType, estimate };
    });

  return { eligibleOwners: owners.length, eligibleWeight, totals, owners: lines, items };
}

// ── Attendance summary (§6, §10) ───────────────────────

export interface AttendanceOwnerLine {
  ownerId: string;
  ownerName: string | null;
  unitLabels: string[];
  weight: number;
  state: AttendanceState;
  attendanceId: string | null;
  representativeName: string | null;
  mandateId: string | null;
  checkedInAt: string | null;
  leftAt: string | null;
}

export interface MeetingAttendanceSummary {
  votingId: string;
  closed: boolean;
  eligibleOwners: number;
  presentOwners: number;
  representedOwners: number;
  /** Eligible owners without a row — counted only once the voting is closed. */
  absentOwners: number;
  notRecordedOwners: number;
  eligibleWeight: number;
  /** Present + represented owners NOT marked as left. Same basis as getVotingResults. */
  presentWeight: number;
  /** Owners present / represented and not marked as left. */
  presentNowOwners: number;
  rows: {
    ownerId: string;
    unitLabel: string;
    ownerName: string | null;
    weight: number;
    status: AttendanceState;
    representativeName: string | null;
    checkedInAt: string | null;
    leftAt: string | null;
  }[];
}

export function buildAttendanceLines(
  eligible: EligibleLine[],
  rows: AttendanceRowIn[],
  closed: boolean
): AttendanceOwnerLine[] {
  const byId = new Map(rows.map((r) => [r.ownerId, r]));
  return byOwner(eligible).map((o) => {
    const r = byId.get(o.ownerId);
    return {
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      unitLabels: o.units.map((u) => u.unitLabel),
      weight: o.weight,
      state: r ? r.status : closed ? "absent" : "not_recorded",
      attendanceId: r?.id ?? null,
      representativeName: r?.representativeName ?? null,
      mandateId: r?.mandateId ?? null,
      checkedInAt: r ? iso(r.checkedInAt) : null,
      leftAt: r ? iso(r.leftAt) : null,
    };
  });
}

export function buildAttendanceSummary(input: {
  votingId: string;
  closed: boolean;
  eligible: EligibleLine[];
  rows: AttendanceRowIn[];
}): MeetingAttendanceSummary {
  const lines = buildAttendanceLines(input.eligible, input.rows, input.closed);
  let presentOwners = 0;
  let representedOwners = 0;
  let absentOwners = 0;
  let notRecordedOwners = 0;
  let presentNowOwners = 0;
  let eligibleWeight = 0;
  let presentWeight = 0;
  for (const l of lines) {
    eligibleWeight += l.weight;
    if (l.state === "present") presentOwners += 1;
    else if (l.state === "represented") representedOwners += 1;
    else if (l.state === "absent") absentOwners += 1;
    else notRecordedOwners += 1;
    if ((l.state === "present" || l.state === "represented") && !l.leftAt) {
      presentNowOwners += 1;
      presentWeight += l.weight;
    }
  }
  return {
    votingId: input.votingId,
    closed: input.closed,
    eligibleOwners: lines.length,
    presentOwners,
    representedOwners,
    absentOwners,
    notRecordedOwners,
    eligibleWeight,
    presentWeight,
    presentNowOwners,
    rows: lines.map((l) => ({
      ownerId: l.ownerId,
      unitLabel: l.unitLabels.join(", "),
      ownerName: l.ownerName,
      weight: l.weight,
      status: l.state,
      representativeName: l.representativeName,
      checkedInAt: l.checkedInAt,
      leftAt: l.leftAt,
    })),
  };
}

// ── Export rows (§7) ───────────────────────────────────

export type ExportRowMode = "owner" | "unit";
export type ExportDocument = "blank" | "filled";

/**
 * The full, closed column set of both export documents. No e-mail, phone or
 * address column exists (GDPR §9 / spec AC "assert the full column set").
 */
export const EXPORT_COLUMNS = {
  blank: ["unit", "owner", "share", "signature", "representedBy"],
  filled: ["unit", "owner", "share", "state", "representedBy", "arrivedAt", "leftAt"],
} as const;

export interface ExportRow {
  unit: string;
  owner: string;
  /** Share of all votes in percent (2 decimals). */
  sharePct: number;
  state: AttendanceState;
  representedBy: string | null;
  arrivedAt: string | null;
  leftAt: string | null;
}

export interface AttendanceExport {
  document: ExportDocument;
  mode: ExportRowMode;
  rows: ExportRow[];
  totals: {
    eligibleOwners: number;
    presentOwners: number;
    representedOwners: number;
    presentSharePct: number;
  };
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;

/**
 * Rows for the blank sign-in sheet and the filled list. One server function,
 * two renderers (xlsx on the server, PDF in the browser) — same rows and
 * totals for the same options. Totals are mode-independent.
 *
 * TODO(decision): "include non-residential units / garages" is hidden until
 * units carry a unit-type discriminator (spec Decisions 6).
 */
export function buildAttendanceExport(input: {
  document: ExportDocument;
  mode: ExportRowMode;
  eligible: EligibleLine[];
  rows: AttendanceRowIn[];
  closed: boolean;
}): AttendanceExport {
  const summary = buildAttendanceSummary({
    votingId: "",
    closed: input.closed,
    eligible: input.eligible,
    rows: input.rows,
  });
  const total = summary.eligibleWeight;
  const byOwnerId = new Map(summary.rows.map((r) => [r.ownerId, r]));
  const filled = input.document === "filled";

  const toRow = (
    unit: string,
    ownerId: string,
    ownerName: string | null,
    weight: number
  ): ExportRow => {
    const s = byOwnerId.get(ownerId);
    return {
      unit,
      owner: ownerName ?? "—",
      sharePct: pct(weight, total),
      state: filled && s ? s.status : "not_recorded",
      representedBy: filled ? s?.representativeName ?? null : null,
      arrivedAt: filled ? s?.checkedInAt ?? null : null,
      leftAt: filled ? s?.leftAt ?? null : null,
    };
  };

  let rows: ExportRow[];
  if (input.mode === "owner") {
    rows = summary.rows.map((r) => toRow(r.unitLabel, r.ownerId, r.ownerName, r.weight));
  } else {
    rows = [...input.eligible]
      .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true }))
      .map((e) => toRow(e.unitLabel, e.ownerId, e.ownerName, e.weight));
  }

  return {
    document: input.document,
    mode: input.mode,
    rows,
    totals: {
      eligibleOwners: summary.eligibleOwners,
      presentOwners: filled ? summary.presentOwners : 0,
      representedOwners: filled ? summary.representedOwners : 0,
      presentSharePct: filled ? pct(summary.presentWeight, total) : 0,
    },
  };
}

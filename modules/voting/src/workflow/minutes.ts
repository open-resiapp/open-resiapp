// BYT-20261118-002 §7 — typed data hand-off for the minutes PDF. Pure, no
// i18n (texts that need translation come in as callbacks / pre-formatted).
//
// Phase A (this file): the assembly that lived inside DownloadMinutesButton
// moved here UNCHANGED, plus a `MinutesProtocol` object (place, officials,
// e-voter name list, reopen statements, publication date) that is passed to
// VotingMinutesPDF but NOT rendered.
// TODO(legal-signoff): Phase B — the PDF sections for `protocol` (§14a ods. 8
// písm. a), f)) and their Slovak wording are blocked on a recorded legal
// sign-off (spec Decisions 4). VotingMinutesPDF legal text is untouched.
import type { QuorumType, VotingResults } from "@/types";

export interface MinutesBallotIn {
  id: string;
  entityId: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  ballotHash: string;
  recordedAt: string;
  confirmationMethod?: string | null;
  confirmedAt?: string | null;
  choices: { itemId: string; choice: string; itemAuditHash: string }[];
}

export interface MinutesItemIn {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
}

export interface MinutesProtocol {
  place: string | null;
  officials: {
    role: "chair" | "recorder" | "verifier";
    name: string;
    refusedToSign: boolean;
    refusalStatement: string | null;
  }[];
  /** §14a ods. 8: name list of owners who voted electronically. */
  electronicVoters: { ownerName: string | null; flatNumber: string }[];
  /** Reopen statements (date ISO + note), oldest first. */
  reopenings: { at: string; note: string | null }[];
  resultPublishedAt: string | null;
  /**
   * BYT-20261118-001 §10: attendance (prezenčná listina) of a meeting voting —
   * from getMeetingAttendanceSummary. Data only, NOT rendered.
   */
  attendance?: MinutesAttendance | null;
  /**
   * 2026-11-18: who counted as "present" in the tally of a meeting voting
   * (SK §14b ods. 4 denominator, CZ §1206 ods. 2 quorum) — taken from the
   * engine result, so the minutes state exactly what the result used.
   * Data only. TODO(legal): printing it in VotingMinutesPDF (wording of the
   * attendance / quorum paragraph) needs the legal-copy sign-off.
   */
  presence?: MinutesPresence | null;
}

export interface MinutesPresence {
  /** "attendance" = prezenčná listina; "cast" = list empty, fell back to ballots. */
  basis: "attendance" | "cast";
  presentOwners: number;
  presentWeight: number;
  /** presentWeight / totalPossibleWeight (0..1). */
  presentShare: number;
  totalPossibleWeight: number;
  /** CZ only. */
  meetingQuorumReached: boolean | null;
}

export interface MinutesAttendance {
  eligibleOwners: number;
  presentOwners: number;
  representedOwners: number;
  absentOwners: number;
  eligibleWeight: number;
  presentWeight: number;
}

export function buildMinutesInput(input: {
  items: MinutesItemIn[];
  results: (VotingResults & { itemId: string })[];
  ballots: MinutesBallotIn[];
  /** Localised confirmation line of a ballot (null for paper). */
  confirmationText: (b: MinutesBallotIn) => string | null;
  protocolSource?: {
    place?: string | null;
    officials?: MinutesProtocol["officials"];
    events?: { kind: string; note: string | null; createdAt: string }[];
    resultPublishedAt?: string | null;
    attendance?: MinutesAttendance | null;
  };
}) {
  const { ballots } = input;

  const flatNumbersByUnitId: Record<string, string> = {};
  for (const b of ballots) {
    if (!flatNumbersByUnitId[b.entityId]) flatNumbersByUnitId[b.entityId] = b.flatNumber;
  }

  // One PDF section per item (resolution). Each item's vote list is rebuilt
  // from the ballots' per-item choices, carrying itemAuditHash.
  const items = [...input.items]
    .sort((a, b) => a.idx - b.idx)
    .map((item) => {
      const result = input.results.find((r) => r.itemId === item.id);
      const votes = ballots.flatMap((b) => {
        const c = b.choices.find((ch) => ch.itemId === item.id);
        return c
          ? [
              {
                flatNumber: b.flatNumber,
                ownerName: b.ownerName,
                choice: c.choice,
                itemAuditHash: c.itemAuditHash,
              },
            ]
          : [];
      });
      return {
        idx: item.idx,
        title: item.title,
        description: item.description,
        quorumType: item.quorumType,
        result: result as VotingResults,
        votes,
      };
    });

  const ballotRows = ballots.map((b) => ({
    id: b.id,
    ownerName: b.ownerName,
    flatNumber: b.flatNumber,
    voteType: b.voteType,
    recordedAt: b.recordedAt,
    ballotHash: b.ballotHash,
    confirmation: input.confirmationText(b),
  }));

  const src = input.protocolSource;
  const protocol: MinutesProtocol | undefined = src
    ? {
        place: src.place ?? null,
        officials: src.officials ?? [],
        electronicVoters: ballots
          .filter((b) => b.voteType !== "paper")
          .map((b) => ({ ownerName: b.ownerName, flatNumber: b.flatNumber })),
        reopenings: (src.events ?? [])
          .filter((e) => e.kind === "reopened")
          .map((e) => ({ at: e.createdAt, note: e.note })),
        resultPublishedAt: src.resultPublishedAt ?? null,
        attendance: src.attendance ?? null,
        presence: presenceOf(input.results),
      }
    : undefined;

  return { items, ballots: ballotRows, flatNumbersByUnitId, protocol };
}

/** Presence is voting-level (same for every item) — read it from the first result carrying it. */
function presenceOf(results: VotingResults[]): MinutesPresence | null {
  const r = results.find((x) => x.presence);
  if (!r?.presence) return null;
  return {
    basis: r.presence.basis,
    presentOwners: r.presence.owners,
    presentWeight: r.presence.weight,
    presentShare: r.presence.share,
    totalPossibleWeight: r.totalPossibleWeight,
    meetingQuorumReached: r.presence.meetingQuorumReached ?? null,
  };
}

// ── Minutes history (spec §6 "Documents after reopen") ─────────────────
// Pure. A minutes document generated / finalised before a later `reopened`
// event is SUPERSEDED ("Zápisnica v1 — nahradená"): it must not be offered
// as the current minutes. transitions.server.ts also writes the superseded
// versions onto the `reopened` event payload (append-only marker).

export interface MinutesHistoryEntry {
  version: number;
  kind: "document_generated" | "minutes_finalised";
  at: Date;
  contentHash: string | null;
  superseded: boolean;
}

export function minutesHistory(
  events: { kind: string; payload: unknown; createdAt: Date }[]
): MinutesHistoryEntry[] {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const reopenTimes = sorted.filter((e) => e.kind === "reopened").map((e) => e.createdAt.getTime());
  const out: MinutesHistoryEntry[] = [];
  let closes = 0;
  for (const e of sorted) {
    if (e.kind === "closed") closes += 1;
    const p = (e.payload ?? {}) as { doc?: unknown; version?: unknown; contentHash?: unknown };
    const isMinutesDoc = e.kind === "document_generated" && p.doc === "minutes";
    if (!isMinutesDoc && e.kind !== "minutes_finalised") continue;
    const t = e.createdAt.getTime();
    out.push({
      version: typeof p.version === "number" ? p.version : Math.max(1, closes),
      kind: e.kind as MinutesHistoryEntry["kind"],
      at: e.createdAt,
      contentHash: typeof p.contentHash === "string" ? p.contentHash : null,
      superseded: reopenTimes.some((r) => r > t),
    });
  }
  return out;
}

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
   * TODO(legal): §14b ods. 4 "present" — the engine measures simple_present
   * against cast ballots; whether presentWeight should be the denominator,
   * and the attendance paragraph wording, need legal sign-off (spec L3, L5).
   */
  attendance?: MinutesAttendance | null;
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
      }
    : undefined;

  return { items, ballots: ballotRows, flatNumbersByUnitId, protocol };
}

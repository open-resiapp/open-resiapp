// Shapes shared by the voting detail page, the owner ballot and the board
// console (from /api/votings/[id] and /api/ballots).
import type {
  QuorumType,
  VotingInitiatedBy,
  VotingResults as VotingResultsType,
  VotingStatus,
  VotingType,
} from "@/types";

export interface VotingDetail {
  id: string;
  title: string;
  description: string | null;
  status: VotingStatus;
  votingType: VotingType;
  initiatedBy: VotingInitiatedBy;
  startsAt: string;
  endsAt: string;
  voteCounterId: string | null;
  entranceId: string | null;
  entranceName: string | null;
  createdBy: { id: string; name: string } | null;
  documentProjectId: string | null;
  // BYT-20261118-002
  place?: string | null;
  announcedAt?: string | null;
  resultPublishedAt?: string | null;
  officials?: VotingOfficial[];
  items?: VotingItemRow[];
  /** Board only. */
  events?: VotingEvent[];
  /** Board only: minutes history; `superseded` = generated before a later reopen. */
  minutes?: VotingMinutesEntry[];
}

export interface VotingMinutesEntry {
  version: number;
  kind: "document_generated" | "minutes_finalised";
  at: string;
  contentHash: string | null;
  superseded: boolean;
}

export interface VotingOfficial {
  id?: string;
  role: "chair" | "recorder" | "verifier";
  name: string;
  userId: string | null;
  refusedToSign: boolean;
  refusalStatement: string | null;
}

export interface VotingEvent {
  id: string;
  kind:
    | "announced"
    | "closed"
    | "reopened"
    | "result_published"
    | "ballot_superseded"
    | "document_generated"
    | "minutes_finalised"
    | "mandate_revoked";
  actorName: string | null;
  note: string | null;
  payload: unknown;
  createdAt: string;
}

// ── BYT-20260609-008 multi-item ballot shapes (from /api/ballots) ──
export interface VotingItemRow {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
  /** SK §14b ods. 6 repeat: category of the original decision. */
  repeatOfQuorumType?: QuorumType | null;
}
export interface BallotChoice {
  itemId: string;
  choice: string;
  itemAuditHash: string;
}
export interface BallotPhoto {
  storageKey: string;
  idx: number;
}
export interface BallotRow {
  id: string;
  entityId: string;
  ownerId: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  ballotHash: string;
  recordedAt: string;
  disputed: boolean;
  confirmationMethod: string | null;
  confirmedAt: string | null;
  choices: BallotChoice[];
  photos: BallotPhoto[];
}
export interface UserBallot {
  ballotId: string;
  flatId: string;
  voteType: string;
  recordedAt: string;
  ballotHash: string;
  confirmationMethod: string | null;
  confirmedAt: string | null;
  choices: Record<string, string>;
}
export interface UserFlat {
  flatId: string;
  flatNumber: string;
}
export interface BallotData {
  items: VotingItemRow[];
  results: (VotingResultsType & { itemId: string })[];
  ballots: BallotRow[];
  userBallots: UserBallot[];
  userFlats: UserFlat[];
  totalBallots: number;
  totalPossibleWeight: number;
  /** Caller has an ACTIVATED passkey (one that may confirm a ballot). */
  hasPasskey: boolean;
  /** Caller has a passkey still waiting for its e-mail activation link. */
  hasPendingPasskey?: boolean;
  /** Board / vote counter only: turnout and the owners who have not voted. */
  participation?: {
    eligibleCount: number;
    votedCount: number;
    eligibleWeight: number;
    votedWeight: number;
    notVoted: { unitId: string; unitLabel: string; ownerId: string; ownerName: string | null }[];
  } | null;
  /** Board / vote counter only (BYT-20261118-002 §5). */
  overview?: VotingOverviewData | null;
}

// BYT-20261118-002 §5 — board management view (from /api/ballots).
export interface OverviewOwnerLine {
  ownerId: string;
  ownerName: string | null;
  shareNumerator: number;
  shareDenominator: number;
  choice: "za" | "proti" | "zdrzal_sa" | null;
  channel: "electronic" | "paper" | null;
  recordedAt: string | null;
}
export interface OverviewUnitLine {
  unitId: string;
  unitLabel: string;
  status: "resolved_for" | "resolved_against" | "resolved_abstain" | "incomplete" | "no_valid_vote";
  channel: "electronic" | "paper" | "mixed" | "none";
  owners: OverviewOwnerLine[];
}
export interface VotingOverviewData {
  items: { itemId: string; units: OverviewUnitLine[] }[];
  channels: { itemId: string; electronic: number; paper: number; cast: number }[];
  outlook: Record<string, "passed" | "reachable" | "unreachable">;
  generatedAt: string;
}

export interface BuildingInfo {
  name: string;
  address: string;
  ico: string | null;
  country?: "sk" | "cz";
  /** Root template slug (null on pre-template installs = hoa). */
  templateSlug?: string | null;
}

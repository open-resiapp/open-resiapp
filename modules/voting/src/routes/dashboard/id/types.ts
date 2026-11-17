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
}

// ── BYT-20260609-008 multi-item ballot shapes (from /api/ballots) ──
export interface VotingItemRow {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
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
}

export interface BuildingInfo {
  name: string;
  address: string;
  ico: string | null;
  country?: "sk" | "cz";
}

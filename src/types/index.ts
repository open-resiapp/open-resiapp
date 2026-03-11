import type { InferSelectModel } from "drizzle-orm";
import type {
  building,
  entrances,
  flats,
  users,
  votings,
  votes,
  mandates,
  posts,
  documents,
  invitations,
  userFlats,
  pushSubscriptions,
  notificationPreferences,
  externalConnections,
  pairingRequests,
  consentRecords,
} from "@/db/schema";

export type Building = InferSelectModel<typeof building>;
export type Entrance = InferSelectModel<typeof entrances>;
export type Flat = InferSelectModel<typeof flats>;
export type User = InferSelectModel<typeof users>;
export type Voting = InferSelectModel<typeof votings>;
export type Vote = InferSelectModel<typeof votes>;
export type Mandate = InferSelectModel<typeof mandates>;
export type Post = InferSelectModel<typeof posts>;
export type Document = InferSelectModel<typeof documents>;
export type Invitation = InferSelectModel<typeof invitations>;
export type UserFlat = InferSelectModel<typeof userFlats>;
export type PushSubscription = InferSelectModel<typeof pushSubscriptions>;
export type NotificationPreference = InferSelectModel<typeof notificationPreferences>;
export type ExternalConnection = InferSelectModel<typeof externalConnections>;
export type PairingRequest = InferSelectModel<typeof pairingRequests>;
export type ConsentRecord = InferSelectModel<typeof consentRecords>;

export type UserRole = "admin" | "owner" | "tenant" | "vote_counter" | "caretaker";
export type ApiKeyPermission = "read" | "read_write" | "full";
export type PairingStatus = "pending" | "completed" | "expired" | "revoked";
export type ConnectionType = "druzstvo" | "energy" | "housekeeper" | "other";
export type NotificationType = "newPost" | "votingStarted";
export type VoteChoice = "za" | "proti" | "zdrzal_sa";
export type VoteType = "electronic" | "paper";
export type VotingStatus = "draft" | "active" | "closed";
export type PostCategory = "info" | "urgent" | "event" | "maintenance";
export type InvitationStatus = "pending" | "used" | "expired";
export type VotingMethod = "per_share" | "per_flat" | "per_area";
export type VotingType = "written" | "meeting";
export type VotingInitiatedBy = "board" | "owners_quarter";
export type QuorumType = "simple_present" | "simple_all" | "two_thirds_all";
export type ConsentType = "data_processing" | "communication";
export type ConsentAction = "granted" | "withdrawn";

export type SafeUser = Omit<User, "passwordHash">;

export interface VoteWithShare {
  choice: VoteChoice;
  shareNumerator: number;
  shareDenominator: number;
  area: number | null;
}

export interface VotingResults {
  za: number;
  proti: number;
  zdrzalSa: number;
  total: number;
  zaPercent: number;
  protiPercent: number;
  zdrzalSaPercent: number;
  passed: boolean;
  quorumReached: boolean;
  quorumType: QuorumType;
  totalPossibleWeight: number;
}

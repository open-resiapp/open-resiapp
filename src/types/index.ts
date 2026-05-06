import type { InferSelectModel } from "drizzle-orm";
import type {
  users,
  posts,
  documents,
  invitations,
  pushSubscriptions,
  notificationPreferences,
  externalConnections,
  pairingRequests,
  consentRecords,
  boardMembers,
  entities,
  housingRootData,
  housingUnitData,
  memberships,
} from "@/db/schema";
import type {
  votings,
  votes,
  mandates,
} from "@modules/voting/src/db/schema";

// Phase 9.2 type aliases — Building/Entrance/Flat/UserFlat are now
// derived from the entity tree. Legacy callers keep the same TS names
// so call-site signatures don't churn until they're rewritten.
export type Entity = InferSelectModel<typeof entities>;
export type HousingRootData = InferSelectModel<typeof housingRootData>;
export type HousingUnitData = InferSelectModel<typeof housingUnitData>;
export type Membership = InferSelectModel<typeof memberships>;

export type Building = Entity & HousingRootData;
export type Entrance = Entity;
export type Flat = Entity & HousingUnitData;
export type UserFlat = { userId: string; flatId: string };

export type User = InferSelectModel<typeof users>;
export type Voting = InferSelectModel<typeof votings>;
export type Vote = InferSelectModel<typeof votes>;
export type Mandate = InferSelectModel<typeof mandates>;
export type Post = InferSelectModel<typeof posts>;
export type Document = InferSelectModel<typeof documents>;
export type Invitation = InferSelectModel<typeof invitations>;
export type PushSubscription = InferSelectModel<typeof pushSubscriptions>;
export type NotificationPreference = InferSelectModel<typeof notificationPreferences>;
export type ExternalConnection = InferSelectModel<typeof externalConnections>;
export type PairingRequest = InferSelectModel<typeof pairingRequests>;
export type ConsentRecord = InferSelectModel<typeof consentRecords>;
export type BoardMember = InferSelectModel<typeof boardMembers>;
export type GovernanceModel = "chairman_council" | "committee" | "chairman_only";
export type BoardMemberRole = "chairman" | "council_member" | "committee_member" | "committee_chairman";

export type UserRole = "admin" | "owner" | "tenant" | "vote_counter" | "caretaker";
export type UserStatus = "pending" | "active" | "rejected";
export type ApiKeyPermission = "read" | "read_write" | "full";
export type PairingStatus = "pending" | "completed" | "expired" | "revoked" | "locked";
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
export type QuorumType = "simple_present" | "simple_all" | "two_thirds_all" | "all_unanimous";
export type Country = "sk" | "cz";
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

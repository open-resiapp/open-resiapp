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
  memberships,
} from "@/db/schema";
import type {
  votings,
  mandates,
} from "@modules/voting/src/db/schema";

// BYT-20260515-001 Phase 8b: Building / Entrance / Flat / UserFlat /
// HousingRootData / HousingUnitData aliases dropped. Per-kind fields
// live on entities.data jsonb; callers either use `Entity` directly
// or declare a local row shape that reflects the jsonb columns they
// actually read.
export type Entity = InferSelectModel<typeof entities>;
export type Membership = InferSelectModel<typeof memberships>;

export type User = InferSelectModel<typeof users>;
export type Voting = InferSelectModel<typeof votings>;
// BYT-20260609-008: the mod_voting_votes table was dropped for the multi-item
// ballot model. `Vote` remains as a standalone shape for the onVoteCreate
// module hook, which is dormant until ballot-level notifications are wired.
export interface Vote {
  id: string;
  votingId: string;
  ownerId: string;
  entityId: string;
  choice: VoteChoice;
  voteType: VoteType;
  createdAt: Date;
}
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
// BYT-20260515-001 Phase 3: voting methods generalized for multi-kind
// communities. Canonical names live in @/lib/voting-method; legacy
// values (`per_share`, `per_flat`) stay accepted via normalizeVotingMethod()
// so existing housingRootData rows and audit logs keep working.
export type VotingMethod =
  | "weighted_by_share"
  | "one_per_unit"
  | "per_area"
  | "one_per_member"
  | "custom_weight"
  | "per_share"
  | "per_flat";
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

/**
 * BYT-20260511-001: full ownership context for a single vote so the engine
 * can group by unit and resolve multi-owner cases per §14 ods. 4 zák.
 * 182/1993 Z.z. (Slovak HOA law) / §1187 CZ Civil Code.
 *
 * One row per (voter, unit). Multiple rows for the same unit are co-owners.
 */
export interface VoteWithOwnership {
  unitEntityId: string;
  userId: string;
  userName: string | null;
  choice: VoteChoice;
  // Unit-level (constant across all co-owners of one unit). Required by
  // unit-scoped methods (weighted_by_share, one_per_unit, per_area).
  unitShareNumerator: number;
  unitShareDenominator: number;
  area: number | null;
  // Owner-level (varies per co-owner; sum across active memberships = 1/1).
  // Used by unit-scoped §14 ods. 4 resolution; ignored by member-scoped.
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  // Optional — set when the vote came from a member-scoped voting and the
  // method is `custom_weight`. Defaults to 1 for `one_per_member`.
  membershipWeight?: number;
}

export type UnitResolutionRationale =
  | "single_owner"
  | "unanimous"
  | "majority_share"
  | "tie_abstain"
  | "no_quorum_within_unit";

export interface UnitResolutionBreakdownEntry {
  userId: string;
  userName: string | null;
  choice: VoteChoice;
  ownerShareNumerator: number;
  ownerShareDenominator: number;
}

export interface UnitResolution {
  unitEntityId: string;
  /** Final stance attributed to the unit as a whole. */
  resolved: VoteChoice;
  rationale: UnitResolutionRationale;
  /** Per-co-owner detail; one entry per co-owner who cast any choice. */
  breakdown: UnitResolutionBreakdownEntry[];
  /** Unit's voting weight under the chosen voting method (float). */
  unitWeight: number;
  /** True iff > 1 co-owner has an active membership on this unit. */
  hasMultipleOwners: boolean;
}

/**
 * BYT-20260515-001 Phase 3b: member-scoped voting result row. One entry
 * per voter. Member-scoped voting has no co-owner resolution — each
 * active member casts one vote weighted independently of unit
 * ownership share.
 */
export interface MemberResolution {
  userId: string;
  userName: string | null;
  choice: VoteChoice;
  /** Vote weight: 1 for one_per_member, memberships.weight for custom_weight. */
  weight: number;
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
  /**
   * Per-unit resolution detail. Omitted in legacy callers that only consume
   * the aggregate totals. Always present when calculateResults is fed
   * VoteWithOwnership[] (BYT-20260511-001 path) AND the voting method is
   * unit-scoped (weighted_by_share, one_per_unit, per_area).
   */
  unitBreakdowns?: UnitResolution[];
  /**
   * Per-member detail. Populated only when the voting method is
   * member-scoped (one_per_member, custom_weight). Mutually exclusive
   * with unitBreakdowns.
   */
  memberBreakdowns?: MemberResolution[];
}

// ── Multi-item votings (BYT-20260609-008) ──────────────
// A voting holds an ordered list of items (resolutions); each item carries
// its own quorumType and resolves independently. The voting itself has no
// single pass/fail once this model is live.

export interface VotingItem {
  id: string;
  votingId: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
  createdAt: Date;
}

/**
 * Per-item tally: a full VotingResults plus the item it belongs to. The
 * engine returns one of these per item; there is no voting-level result.
 */
export interface VotingItemResult extends VotingResults {
  itemId: string;
}

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

export type UserRole = "admin" | "owner" | "tenant" | "vote_counter" | "caretaker";
export type VoteChoice = "za" | "proti" | "zdrzal_sa";
export type VoteType = "electronic" | "paper";
export type VotingStatus = "draft" | "active" | "closed";
export type PostCategory = "info" | "urgent" | "event" | "maintenance";
export type InvitationStatus = "pending" | "used" | "expired";
export type VotingMethod = "per_share" | "per_flat" | "per_area";

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
}

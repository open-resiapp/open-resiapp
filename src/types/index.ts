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

export type UserRole = "admin" | "owner" | "tenant" | "vote_counter";
export type VoteChoice = "za" | "proti" | "zdrzal_sa";
export type VoteType = "electronic" | "paper";
export type VotingStatus = "draft" | "active" | "closed";
export type PostCategory = "info" | "urgent" | "event" | "maintenance";

export type SafeUser = Omit<User, "passwordHash">;

export interface VoteWithShare {
  choice: VoteChoice;
  shareNumerator: number;
  shareDenominator: number;
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

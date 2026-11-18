// Client-safe types + helpers for the merged notice board / community feed
// (BYT-20261117-002 Phase 5 "Oznamy / feed"). The feed reads two existing
// sources without a schema change:
//   - board notices      → `posts` table            (key prefix "n-")
//   - community posts    → `community_posts` table  (key prefix "c-")
// Server loading lives in src/lib/feed.server.ts.

import type { PostCategory } from "@/types";

export const FEED_PAGE_SIZE = 20;

/** `?typ=` values of the feed filter chips (shareable, server-rendered). */
export const FEED_FILTERS = ["all", "oznamy", "udalosti", "pomoc", "predaj"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export type CommunityPostType =
  | "sale"
  | "free"
  | "borrow"
  | "help_request"
  | "help_offer"
  | "event";

export type CommunityPostStatus = "active" | "resolved" | "expired";

export type RsvpStatus = "yes" | "maybe" | "no";

/** Community post types shown under each filter chip (null = no community posts). */
export const FILTER_COMMUNITY_TYPES: Record<FeedFilter, CommunityPostType[] | null> = {
  all: ["sale", "free", "borrow", "help_request", "help_offer", "event"],
  oznamy: null,
  udalosti: ["event"],
  pomoc: ["help_request", "help_offer"],
  // "borrow" is no longer offered in the create flow; old posts stay visible here.
  predaj: ["sale", "free", "borrow"],
};

/** `?typ=` values of the create flow (/board/novy). */
export const CREATE_TYPES = ["oznam", "udalost", "pomoc", "predaj"] as const;
export type CreateType = (typeof CREATE_TYPES)[number];

/** Create type that belongs to a filter chip (for "+ Nový" with preselection). */
export const FILTER_CREATE_TYPE: Record<FeedFilter, CreateType | null> = {
  all: null,
  oznamy: "oznam",
  udalosti: "udalost",
  pomoc: "pomoc",
  predaj: "predaj",
};

export interface FeedAuthor {
  id: string;
  name: string;
}

export interface FeedAttachment {
  id: string;
  name: string;
}

export interface FeedNotice {
  kind: "notice";
  key: string;
  id: string;
  title: string;
  content: string;
  category: PostCategory;
  isPinned: boolean;
  createdAt: string;
  entranceName: string | null;
  author: FeedAuthor | null;
  attachments: FeedAttachment[];
}

export interface FeedRsvp {
  yes: number;
  maybe: number;
  no: number;
  myRsvp: RsvpStatus | null;
}

export interface FeedCommunityPost {
  kind: "community";
  key: string;
  id: string;
  type: CommunityPostType;
  status: CommunityPostStatus;
  title: string;
  content: string;
  photoUrl: string | null;
  eventDate: string | null;
  eventLocation: string | null;
  /** BYT-20261118-001: "owners_meeting" = announcement of a meeting voting. */
  eventKind: "social" | "owners_meeting";
  entranceName: string | null;
  expiresAt: string | null;
  createdAt: string;
  author: FeedAuthor | null;
  responsesAllowed: boolean;
  responseCount: number;
  rsvp: FeedRsvp | null;
  attachments: FeedAttachment[];
}

export type FeedItem = FeedNotice | FeedCommunityPost;

export const noticeKey = (id: string) => `n-${id}`;
export const communityKey = (id: string) => `c-${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `?prispevok=n-<uuid>|c-<uuid>` (deep link from notifications). */
export function parseItemKey(
  raw: unknown
): { kind: "notice" | "community"; id: string } | null {
  if (typeof raw !== "string") return null;
  const m = /^([nc])-(.+)$/.exec(raw);
  if (!m || !UUID.test(m[2])) return null;
  return { kind: m[1] === "n" ? "notice" : "community", id: m[2] };
}

export function parseFeedFilter(raw: unknown): FeedFilter {
  return typeof raw === "string" && (FEED_FILTERS as readonly string[]).includes(raw)
    ? (raw as FeedFilter)
    : "all";
}

export function parseCreateType(raw: unknown): CreateType | null {
  return typeof raw === "string" && (CREATE_TYPES as readonly string[]).includes(raw)
    ? (raw as CreateType)
    : null;
}

export function parsePage(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 1;
}

// ── Price of a sale post ──
// community_posts has no price column. The create flow appends the price as
// the last line of the content ("Cena: 20 €"); the card lifts it back out.
// Labels of all three locales are recognised (sk/cs "Cena", en "Price").
// Tolerant of trailing spaces / blank lines after the price; an empty
// "Cena:" line is treated as no price and dropped from the body.
const PRICE_LINE = /(?:^|\n)[ \t]*(?:Cena|Price):[ \t]*(.*?)\s*$/;

export function splitPrice(content: string): { body: string; price: string | null } {
  const m = PRICE_LINE.exec(content);
  if (!m) return { body: content, price: null };
  return { body: content.slice(0, m.index).trimEnd(), price: m[1].trim() || null };
}

/**
 * Body + price line. Any price line already at the end of `body` (e.g. the
 * content of a sale post being edited) is replaced, so clearing the price
 * leaves plain text without a stray "Cena:" line.
 */
export function withPrice(body: string, priceLabel: string, price: string): string {
  const clean = splitPrice(body).body.trimEnd();
  const p = price.trim();
  if (!p) return clean;
  return clean ? `${clean}\n\n${priceLabel}: ${p}` : `${priceLabel}: ${p}`;
}

import "server-only";

import { z } from "zod";

import { createPost, getPostScopeEntity } from "@/lib/posts";
import type { Country } from "@/types";
import { normalizeItems, VALID_FINANCIAL_EFFECT, VALID_QUORUM } from "@modules/voting/src/items";
import { validatePerRollamDuration } from "@modules/voting/src/rules";
import { createVoting } from "@modules/voting/src/votings";
import { findDisallowedQuorum } from "@modules/voting/src/quorum-guard.server";
import { assertBoard } from "../authz";
import { validationError } from "../errors";
import { timeZoneForCountry } from "@/lib/time-zone";
import { fmtDateTime, fmtMoney, isDateOnly, translatorFor, zonedDateTimeToUtc } from "./format";
import { defineAction, type PreviewRow } from "./types";

// Governance pending actions (BYT-20261117-001 §4 #29–#30): announcement and
// voting DRAFT. Board = admin or active chairman (+ caretaker for
// announcements) — the same assertBoard the UI routes use (Decided 1).

const POST_CATEGORIES = ["info", "urgent", "event", "maintenance"] as const;
const CATEGORY_KEY: Record<(typeof POST_CATEGORIES)[number], string> = {
  info: "PostCard.categoryInfo",
  urgent: "PostCard.categoryUrgent",
  event: "PostCard.categoryEvent",
  maintenance: "PostCard.categoryMaintenance",
};

const QUORUM_KEY: Record<string, string> = {
  simple_present: "VotingNew.quorumSimplePresent",
  simple_all: "VotingNew.quorumSimpleAll",
  two_thirds_all: "VotingNew.quorumTwoThirdsAll",
  all_unanimous: "VotingNew.quorumAllUnanimous",
};

const PREVIEW_BODY_MAX = 1500;

// ── #29 create_announcement ──────────────────────────────────────────────

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200).describe("Announcement title."),
  content: z.string().trim().min(1).max(10_000).describe("Announcement body (plain text)."),
  category: z.enum(POST_CATEGORIES).optional().describe("info (default) | urgent | event | maintenance."),
  isPinned: z.boolean().optional().describe("Pin to the top of the board."),
  entranceId: z.string().uuid().optional().describe("Limit to one entrance / sub-entity; omit for the whole community."),
});

const createAnnouncement = defineAction({
  kind: "create_announcement",
  scopes: ["read", "governance:write"],
  schema: announcementSchema,
  authorize: (ctx) => assertBoard(ctx.principal, { allowCaretaker: true }),
  async validate(ctx, p) {
    if (p.entranceId) {
      const scope = await getPostScopeEntity(ctx.root.id, p.entranceId);
      if (!scope) throw validationError("entranceId");
    }
    return { ...p, category: p.category ?? "info", isPinned: p.isPinned === true };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const scope = p.entranceId ? await getPostScopeEntity(ctx.root.id, p.entranceId) : null;
    const body =
      p.content.length > PREVIEW_BODY_MAX ? `${p.content.slice(0, PREVIEW_BODY_MAX)}…` : p.content;
    return {
      title: t("Mcp.actions.create_announcement.title"),
      summary: t("Mcp.actions.create_announcement.summary", { title: p.title }),
      rows: [
        { label: t("Mcp.preview.postTitle"), value: p.title, untrusted: true },
        { label: t("Mcp.preview.postContent"), value: body, untrusted: true, multiline: true },
        { label: t("Mcp.preview.category"), value: t(CATEGORY_KEY[p.category ?? "info"]) },
        { label: t("Mcp.preview.pinned"), value: p.isPinned ? t("Mcp.preview.yes") : t("Mcp.preview.no") },
        { label: t("Mcp.preview.audience"), value: scope ? scope.name : t("Mcp.preview.wholeCommunity") },
      ],
      consequences: [t("Mcp.consequences.publishedImmediately"), t("Mcp.consequences.pushToAll")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    const post = await createPost(ctx.principal, {
      title: p.title,
      content: p.content,
      category: p.category ?? "info",
      isPinned: p.isPinned === true,
      entranceId: p.entranceId ?? null,
    });
    return { data: { postId: post.id }, path: "/board" };
  },
});

// ── #30 draft_voting ─────────────────────────────────────────────────────

const itemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).optional(),
  quorumType: z.enum(VALID_QUORUM as [string, ...string[]]).describe(
    "simple_present | simple_all | two_thirds_all | all_unanimous. Only types allowed for the community's country and voting type are accepted: simple_present (majority of those present) is for meetings only, never for written (per rollam) votings."
  ),
  financialEffectKind: z
    .enum(VALID_FINANCIAL_EFFECT as [string, ...string[]])
    .optional()
    .describe("Optional: fpuo_rate_change (params.newRateCents) or expense_approval (params.amountCents)."),
  financialEffectParams: z.record(z.string(), z.unknown()).optional(),
});

export const draftVotingSchema = z.object({
  title: z.string().trim().min(1).max(500).describe("Voting title."),
  description: z.string().max(10_000).optional(),
  votingType: z.enum(["written", "meeting"]).optional().describe("written (per rollam, default) | meeting."),
  startsAt: z
    .string()
    .min(8)
    .max(40)
    .describe("Start (ISO 8601). A bare date (YYYY-MM-DD) means 00:00 in the community's time zone."),
  endsAt: z
    .string()
    .min(8)
    .max(40)
    .describe(
      "End (ISO 8601). A bare date (YYYY-MM-DD) means the END of that day, 23:59:59 in the community's time zone. Written votings have a statutory minimum duration."
    ),
  items: z.array(itemSchema).min(1).max(30).describe("Ballot items, each with its own quorum."),
});

const draftVoting = defineAction({
  kind: "draft_voting",
  module: "voting",
  scopes: ["read", "governance:write"],
  schema: draftVotingSchema,
  authorize: (ctx) => assertBoard(ctx.principal),
  async validate(ctx, p) {
    // Same fallback as createVoting: a community without a country is SK.
    const country = (ctx.root.country ?? "sk") as Country;
    // A bare date is a calendar day in the community's time zone: the start
    // opens at 00:00, the end closes at 23:59:59 — "until 30. 11." means the
    // whole 30th, not midnight UTC at its start. The normalised payload
    // carries full ISO instants, so re-validation at confirm is identical.
    const tz = timeZoneForCountry(country);
    const start = isDateOnly(p.startsAt)
      ? zonedDateTimeToUtc(p.startsAt, { h: 0, m: 0, s: 0 }, tz)
      : new Date(p.startsAt);
    const end = isDateOnly(p.endsAt)
      ? zonedDateTimeToUtc(p.endsAt, { h: 23, m: 59, s: 59 }, tz)
      : new Date(p.endsAt);
    if (!start || Number.isNaN(start.getTime())) throw validationError("startsAt");
    if (!end || Number.isNaN(end.getTime()) || end <= start) throw validationError("endsAt");
    const votingType = p.votingType ?? "written";
    if (votingType === "written") {
      const minEnd = validatePerRollamDuration(country, start, end);
      if (minEnd) {
        throw validationError("endsAt", {
          reason: "per_rollam_min_duration",
          minEnd: minEnd.toISOString().split("T")[0],
        });
      }
    }
    const normalized = normalizeItems({ items: p.items }, p.title, p.description ?? null);
    if ("error" in normalized) throw validationError("items");
    // Run the same quorum guard createVoting runs at commit, so a proposal
    // that would fail on confirm is rejected now, with the allowed types.
    const quorumError = findDisallowedQuorum(normalized.items, country, votingType);
    if (quorumError) {
      throw validationError("items", {
        reason: "quorum_not_allowed",
        itemIdx: quorumError.itemIdx,
        allowed: quorumError.allowed,
      });
    }
    return {
      ...p,
      votingType,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      items: normalized.items.map((it) => ({
        title: it.title,
        ...(it.description ? { description: it.description } : {}),
        quorumType: it.quorumType,
        ...(it.financialEffectKind
          ? { financialEffectKind: it.financialEffectKind, financialEffectParams: it.financialEffectParams ?? {} }
          : {}),
      })),
    };
  },
  async preview(_ctx, p, locale) {
    const t = await translatorFor(locale);
    const itemRows: PreviewRow[] = p.items.map((it, i) => {
      const params = (it.financialEffectParams ?? {}) as Record<string, unknown>;
      const effect =
        it.financialEffectKind === "fpuo_rate_change" && typeof params.newRateCents === "number"
          ? t("Mcp.preview.effect_fpuo_rate_change", { amount: fmtMoney(params.newRateCents, locale) })
          : it.financialEffectKind === "expense_approval" && typeof params.amountCents === "number"
            ? t("Mcp.preview.effect_expense_approval", { amount: fmtMoney(params.amountCents, locale) })
            : null;
      return {
        label: t("Mcp.preview.itemN", { n: i + 1 }),
        value: [it.title, t(QUORUM_KEY[it.quorumType] ?? "VotingNew.quorumSimpleAll"), effect]
          .filter(Boolean)
          .join(" · "),
        untrusted: true,
      };
    });
    return {
      title: t("Mcp.actions.draft_voting.title"),
      summary: t("Mcp.actions.draft_voting.summary", { title: p.title, count: p.items.length }),
      rows: [
        { label: t("Mcp.preview.votingTitle"), value: p.title, untrusted: true },
        ...(p.description
          ? [{ label: t("Mcp.preview.description"), value: p.description, untrusted: true, multiline: true }]
          : []),
        { label: t("Mcp.preview.votingType"), value: t(`Mcp.preview.votingType_${p.votingType ?? "written"}`) },
        { label: t("Mcp.preview.startsAt"), value: fmtDateTime(p.startsAt, locale) },
        { label: t("Mcp.preview.endsAt"), value: fmtDateTime(p.endsAt, locale) },
        ...itemRows,
        { label: t("Mcp.preview.status"), before: "—", after: t("Mcp.preview.statusDraft") },
      ],
      consequences: [t("Mcp.consequences.votingDraftOnly")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    const voting = await createVoting(
      ctx.principal,
      {
        title: p.title,
        description: p.description ?? null,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        votingType: p.votingType ?? "written",
        initiatedBy: "board",
        items: p.items,
      },
      { forceDraft: true }
    );
    return { data: { votingId: voting.id, status: voting.status }, path: `/voting/${voting.id}` };
  },
});

export const GOVERNANCE_ACTIONS = [createAnnouncement, draftVoting];

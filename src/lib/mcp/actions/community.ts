import "server-only";

import { z } from "zod";

import {
  createCommunityPost,
  deleteCommunityPost,
  deleteDirectoryEntry,
  getDirectoryEntry,
  getMyEventRsvp,
  loadCommunityPostRow,
  normalizeDirectoryEntry,
  setSocialEventRsvp,
  updateCommunityPost,
  upsertDirectoryEntry,
  validateCommunityPostInput,
  type CommunityActor,
  type RsvpStatus,
} from "@/lib/community.server";
import { getVisibleCommunityPost } from "@/lib/feed.server";
import { hasPermission } from "@/lib/permissions";
import { getPostScopeEntity } from "@/lib/posts";
import type { UserRole } from "@/types";
import {
  getOwnRsvp,
  isEligibleOwner,
  loadMeetingVotingByPost,
  MeetingError,
  setMeetingRsvp,
} from "@modules/voting/src/attendance";
import { meetingRsvpWriteError } from "@modules/voting/src/workflow/attendance";
import { McpError, validationError } from "../errors";
import { fmtDateTime, translatorFor } from "./format";
import {
  defineAction,
  type ActionContext,
  type AppLocale,
  type PreviewRow,
  type Translator,
} from "./types";

// Community pending actions (BYT-20261118-012 §4): RSVP to an event (and
// withdraw it), own neighbours' post (create / resolve / delete) and own
// directory entry (set / remove). Same lib functions as the web routes
// (src/lib/community.server.ts; owners' meetings → voting module
// setMeetingRsvp). Every per-user record created here has its undo path as
// its own action (CLAUDE.md spec rule): rsvp_event ↔ clear_event_rsvp,
// create_community_post ↔ resolve / delete_community_post,
// set_directory_entry ↔ remove_directory_entry.
//
// MCP is narrower than the web on two points: the post must be VISIBLE to
// the user (feed rule) before they can answer it, and resolve / delete act
// on the user's OWN posts only (no admin moderation through AI).

const uuid = z.string().uuid();
const SCOPES = ["read", "community:write"] as const;
const POST_PATH = (id: string) => `/board?prispevok=c-${id}`;

const actorOf = (ctx: ActionContext): CommunityActor => ({
  userId: ctx.principal.userId,
  role: ctx.principal.role as UserRole,
});
const viewerOf = (ctx: ActionContext) => ({ id: ctx.principal.userId, role: ctx.principal.role as UserRole });

function requirePermission(ctx: ActionContext, perm: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(ctx.principal.role as UserRole, perm)) throw new McpError("forbidden");
}

/** Voting-module meeting errors → stable MCP codes. */
function meetingError(err: unknown): never {
  if (err instanceof MeetingError) {
    if (err.code === "MEETING_RSVP_CLOSED") {
      throw new McpError("conflict.state_changed", { reason: "meeting_rsvp_closed" });
    }
    if (err.code === "MEETING_RSVP_NOT_ELIGIBLE") {
      throw new McpError("forbidden", { reason: "not_eligible_owner" });
    }
  }
  throw err;
}

const rsvpLabel = (t: Translator, s: RsvpStatus | null) =>
  s ? t(`Mcp.preview.rsvp_${s}`) : t("Mcp.preview.rsvp_none");

/** Visible event post + whether it is an owners' meeting (module + eligibility checked). */
async function loadEvent(ctx: ActionContext, postId: string) {
  const post = await getVisibleCommunityPost(viewerOf(ctx), postId);
  if (!post) throw new McpError("not_found");
  if (post.type !== "event") throw validationError("postId", { reason: "events_only" });
  const meeting = post.eventKind === "owners_meeting";
  if (meeting) {
    if (!ctx.enabledModules.has("voting")) throw new McpError("module_disabled", { module: "voting" });
    const row = await loadCommunityPostRow(postId);
    if (!row) throw new McpError("not_found");
    const windowError = meetingRsvpWriteError(row, new Date());
    if (windowError) throw new McpError("conflict.state_changed", { reason: "meeting_rsvp_closed" });
    const voting = await loadMeetingVotingByPost(postId);
    if (!voting || !(await isEligibleOwner(voting.id, ctx.principal.userId))) {
      throw new McpError("forbidden", { reason: "not_eligible_owner" });
    }
  }
  return { post, meeting };
}

async function currentRsvp(ctx: ActionContext, postId: string, meeting: boolean) {
  return meeting
    ? getOwnRsvp(postId, ctx.principal.userId)
    : getMyEventRsvp(postId, ctx.principal.userId);
}

function eventRows(
  t: Translator,
  locale: AppLocale,
  post: { title: string; eventDate: string | null; eventLocation: string | null }
): PreviewRow[] {
  return [
    { label: t("Mcp.preview.event"), value: post.title, untrusted: true },
    ...(post.eventDate ? [{ label: t("Mcp.preview.eventDate"), value: fmtDateTime(post.eventDate, locale) }] : []),
    ...(post.eventLocation
      ? [{ label: t("Mcp.preview.eventLocation"), value: post.eventLocation, untrusted: true }]
      : []),
  ];
}

// ── rsvp_event ───────────────────────────────────────────────────────────

export const rsvpSchema = z.object({
  postId: uuid.describe("Event post id (list_community_posts section=events)."),
  status: z.enum(["yes", "maybe", "no"]).describe("yes = coming, maybe, no = not coming."),
});

const rsvpEvent = defineAction({
  kind: "rsvp_event",
  scopes: SCOPES,
  schema: rsvpSchema,
  authorize: (ctx) => requirePermission(ctx, "respondToCommunityPost"),
  async validate(ctx, p) {
    await loadEvent(ctx, p.postId);
    return { postId: p.postId, status: p.status };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const { post, meeting } = await loadEvent(ctx, p.postId);
    const before = await currentRsvp(ctx, p.postId, meeting);
    return {
      title: t("Mcp.actions.rsvp_event.title"),
      summary: t("Mcp.actions.rsvp_event.summary", { answer: rsvpLabel(t, p.status), title: post.title }),
      rows: [
        ...eventRows(t, locale, post),
        { label: t("Mcp.preview.rsvp"), before: rsvpLabel(t, before), after: rsvpLabel(t, p.status) },
      ],
      consequences: [
        meeting ? t("Mcp.consequences.meetingRsvpBoard") : t("Mcp.consequences.rsvpCountsVisible"),
        t("Mcp.consequences.rsvpUndo"),
      ],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    // validate() (visibility, meeting window + eligibility) ran just before.
    const meeting = (await loadCommunityPostRow(p.postId))?.eventKind === "owners_meeting";
    if (meeting) {
      await setMeetingRsvp({
        postId: p.postId,
        userId: ctx.principal.userId,
        status: p.status,
        source: "app",
      }).catch(meetingError);
    } else {
      await setSocialEventRsvp(actorOf(ctx), p.postId, p.status);
    }
    return { data: { postId: p.postId, status: p.status }, path: POST_PATH(p.postId) };
  },
});

// ── clear_event_rsvp (undo of rsvp_event) ───────────────────────────────

export const clearRsvpSchema = z.object({
  postId: uuid.describe("Event post id the user answered."),
});

const clearEventRsvp = defineAction({
  kind: "clear_event_rsvp",
  scopes: SCOPES,
  schema: clearRsvpSchema,
  authorize: (ctx) => requirePermission(ctx, "viewCommunity"),
  async validate(ctx, p) {
    const { meeting } = await loadEvent(ctx, p.postId);
    if (!(await currentRsvp(ctx, p.postId, meeting))) {
      throw validationError("postId", { reason: "no_answer" });
    }
    return { postId: p.postId };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const { post, meeting } = await loadEvent(ctx, p.postId);
    const before = await currentRsvp(ctx, p.postId, meeting);
    return {
      title: t("Mcp.actions.clear_event_rsvp.title"),
      summary: t("Mcp.actions.clear_event_rsvp.summary", { title: post.title }),
      rows: [
        ...eventRows(t, locale, post),
        { label: t("Mcp.preview.rsvp"), before: rsvpLabel(t, before), after: rsvpLabel(t, null) },
      ],
      consequences: [t("Mcp.consequences.rsvpWithdrawn")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    // validate() (visibility, meeting window + eligibility) ran just before.
    const meeting = (await loadCommunityPostRow(p.postId))?.eventKind === "owners_meeting";
    if (meeting) {
      await setMeetingRsvp({
        postId: p.postId,
        userId: ctx.principal.userId,
        status: null,
        source: "app",
      }).catch(meetingError);
    } else {
      await setSocialEventRsvp(actorOf(ctx), p.postId, null);
    }
    return { data: { postId: p.postId, status: null }, path: POST_PATH(p.postId) };
  },
});

// ── create_community_post ────────────────────────────────────────────────

const CREATE_TYPES = ["sale", "free", "help_request", "help_offer", "event"] as const;

export const createCommunityPostSchema = z.object({
  type: z
    .enum(CREATE_TYPES)
    .describe("sale (burza, put the price in the text) | free (give away) | help_request | help_offer | event."),
  title: z.string().trim().min(1).max(255).describe("Short title."),
  content: z.string().trim().min(1).max(5000).describe("Post text (plain text)."),
  eventDate: z.string().min(8).max(40).optional().describe("Events only: start (ISO 8601)."),
  eventLocation: z.string().trim().min(1).max(255).optional().describe("Events only: place."),
  entranceId: uuid.optional().describe("Limit to one entrance; omit for the whole community."),
  responsesAllowed: z.boolean().optional().describe("Allow neighbours to respond (default true)."),
});

const createPost = defineAction({
  kind: "create_community_post",
  scopes: SCOPES,
  schema: createCommunityPostSchema,
  authorize: (ctx) => requirePermission(ctx, "createCommunityPost"),
  async validate(ctx, p) {
    const n = await validateCommunityPostInput(actorOf(ctx), p);
    // JSON-safe, deterministic payload (re-validated + hashed at confirm).
    return {
      type: p.type,
      title: n.title,
      content: n.content,
      ...(n.eventDate ? { eventDate: n.eventDate.toISOString() } : {}),
      ...(n.eventLocation ? { eventLocation: n.eventLocation } : {}),
      ...(p.entranceId ? { entranceId: p.entranceId } : {}),
      responsesAllowed: n.responsesAllowed,
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const scope = p.entranceId ? await getPostScopeEntity(ctx.root.id, p.entranceId) : null;
    const audience = scope ? scope.name : t("Mcp.preview.wholeCommunity");
    const warnings = [t("Mcp.warnings.noPhotoViaAi")];
    if (p.eventDate && new Date(p.eventDate).getTime() < Date.now()) {
      warnings.push(t("Mcp.warnings.eventInPast"));
    }
    return {
      title: t("Mcp.actions.create_community_post.title"),
      summary: t("Mcp.actions.create_community_post.summary", {
        type: t(`Mcp.preview.postType_${p.type}`),
        title: p.title,
      }),
      rows: [
        { label: t("Mcp.preview.postType"), value: t(`Mcp.preview.postType_${p.type}`) },
        { label: t("Mcp.preview.postTitle"), value: p.title, untrusted: true },
        { label: t("Mcp.preview.postContent"), value: p.content, untrusted: true, multiline: true },
        ...(p.eventDate ? [{ label: t("Mcp.preview.eventDate"), value: fmtDateTime(p.eventDate, locale) }] : []),
        ...(p.eventLocation
          ? [{ label: t("Mcp.preview.eventLocation"), value: p.eventLocation, untrusted: true }]
          : []),
        { label: t("Mcp.preview.audience"), value: audience },
        {
          label: t("Mcp.preview.responsesAllowed"),
          value: p.responsesAllowed === false ? t("Mcp.preview.no") : t("Mcp.preview.yes"),
        },
      ],
      consequences: [
        t("Mcp.consequences.communityVisible", { audience }),
        t("Mcp.consequences.communityExpires"),
        t("Mcp.consequences.communityUndo"),
      ],
      warnings,
    };
  },
  async commit(ctx, p) {
    const post = await createCommunityPost(actorOf(ctx), p);
    return { data: { postId: post.id }, path: POST_PATH(post.id) };
  },
});

// ── resolve_community_post / delete_community_post (own posts only) ──────

export const ownPostSchema = z.object({
  postId: uuid.describe("Id of the user's OWN post (get_community_post → mine: true)."),
});

async function loadOwnPost(ctx: ActionContext, postId: string) {
  const row = await loadCommunityPostRow(postId);
  if (!row) throw new McpError("not_found");
  // Own posts only — no admin moderation through AI.
  if (row.authorId !== ctx.principal.userId) throw new McpError("forbidden", { reason: "not_author" });
  if (row.eventKind === "owners_meeting") {
    // Meeting announcements are managed with their voting in the app.
    throw validationError("postId", { reason: "owners_meeting" });
  }
  return row;
}

const postTypeLabel = (t: Translator, type: string) => t(`Mcp.preview.postType_${type}`);

const resolvePost = defineAction({
  kind: "resolve_community_post",
  scopes: SCOPES,
  schema: ownPostSchema,
  authorize: (ctx) => requirePermission(ctx, "resolveOwnCommunityPost"),
  async validate(ctx, p) {
    const row = await loadOwnPost(ctx, p.postId);
    if (row.status !== "active") throw new McpError("conflict.state_changed", { reason: "not_active" });
    return { postId: p.postId };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const row = await loadOwnPost(ctx, p.postId);
    return {
      title: t("Mcp.actions.resolve_community_post.title"),
      summary: t("Mcp.actions.resolve_community_post.summary", { title: row.title }),
      rows: [
        { label: t("Mcp.preview.postType"), value: postTypeLabel(t, row.type) },
        { label: t("Mcp.preview.postTitle"), value: row.title, untrusted: true },
        {
          label: t("Mcp.preview.status"),
          before: t("Mcp.preview.postStatusActive"),
          after: t("Mcp.preview.postStatusResolved"),
        },
      ],
      consequences: [t("Mcp.consequences.postResolved")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    await updateCommunityPost(actorOf(ctx), p.postId, { status: "resolved" });
    return { data: { postId: p.postId, status: "resolved" }, path: POST_PATH(p.postId) };
  },
});

const deletePost = defineAction({
  kind: "delete_community_post",
  scopes: SCOPES,
  schema: ownPostSchema,
  authorize: (ctx) => requirePermission(ctx, "deleteOwnCommunityPost"),
  async validate(ctx, p) {
    await loadOwnPost(ctx, p.postId);
    return { postId: p.postId };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const row = await loadOwnPost(ctx, p.postId);
    return {
      title: t("Mcp.actions.delete_community_post.title"),
      summary: t("Mcp.actions.delete_community_post.summary", { title: row.title }),
      rows: [
        { label: t("Mcp.preview.postType"), value: postTypeLabel(t, row.type) },
        { label: t("Mcp.preview.postTitle"), value: row.title, untrusted: true },
      ],
      consequences: [t("Mcp.consequences.postDeleted")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    await deleteCommunityPost(actorOf(ctx), p.postId);
    return { data: { postId: p.postId, deleted: true }, path: "/board" };
  },
});

// ── set_directory_entry / remove_directory_entry ─────────────────────────

export const directorySchema = z.object({
  sharePhone: z.boolean().optional().describe("Show the phone number from the user's profile (default false)."),
  shareEmail: z.boolean().optional().describe("Show the e-mail from the user's profile (default false)."),
  note: z.string().max(255).optional().describe("Short note, e.g. 'byt 12, 2. poschodie'."),
  skills: z.string().max(500).optional().describe("How the user can help neighbours, e.g. 'elektrikár'."),
});

const yesNo = (t: Translator, v: boolean | undefined | null) =>
  v ? t("Mcp.preview.yes") : t("Mcp.preview.no");

const setDirectory = defineAction({
  kind: "set_directory_entry",
  scopes: SCOPES,
  schema: directorySchema,
  authorize: (ctx) => requirePermission(ctx, "editOwnDirectory"),
  async validate(_ctx, p) {
    const n = normalizeDirectoryEntry(p);
    return {
      sharePhone: n.sharePhone,
      shareEmail: n.shareEmail,
      ...(n.note ? { note: n.note } : {}),
      ...(n.skills ? { skills: n.skills } : {}),
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const cur = await getDirectoryEntry(ctx.principal.userId);
    const none = t("Mcp.preview.notInDirectory");
    const consequences = [t("Mcp.consequences.directoryVisible")];
    if (p.sharePhone) consequences.push(t("Mcp.consequences.directoryPhoneShared"));
    if (p.shareEmail) consequences.push(t("Mcp.consequences.directoryEmailShared"));
    consequences.push(t("Mcp.consequences.directoryUndo"));
    return {
      title: t("Mcp.actions.set_directory_entry.title"),
      summary: t(cur ? "Mcp.actions.set_directory_entry.summaryUpdate" : "Mcp.actions.set_directory_entry.summary"),
      rows: [
        {
          label: t("Mcp.preview.sharePhone"),
          before: cur ? yesNo(t, cur.sharePhone) : none,
          after: yesNo(t, p.sharePhone),
        },
        {
          label: t("Mcp.preview.shareEmail"),
          before: cur ? yesNo(t, cur.shareEmail) : none,
          after: yesNo(t, p.shareEmail),
        },
        {
          label: t("Mcp.preview.directoryNote"),
          before: cur ? cur.note ?? "—" : none,
          after: p.note ?? "—",
          untrusted: true,
        },
        {
          label: t("Mcp.preview.directorySkills"),
          before: cur ? cur.skills ?? "—" : none,
          after: p.skills ?? "—",
          untrusted: true,
        },
      ],
      consequences,
      warnings: [],
    };
  },
  async commit(ctx, p) {
    const { entry, created } = await upsertDirectoryEntry(actorOf(ctx), p);
    return { data: { entryId: entry.id, created }, path: "/komunita/adresar" };
  },
});

const removeDirectory = defineAction({
  kind: "remove_directory_entry",
  scopes: SCOPES,
  schema: z.object({}),
  authorize: (ctx) => requirePermission(ctx, "editOwnDirectory"),
  async validate(ctx) {
    if (!(await getDirectoryEntry(ctx.principal.userId))) {
      throw validationError("input", { reason: "no_entry" });
    }
    return {};
  },
  async preview(_ctx, _p, locale) {
    const t = await translatorFor(locale);
    return {
      title: t("Mcp.actions.remove_directory_entry.title"),
      summary: t("Mcp.actions.remove_directory_entry.summary"),
      rows: [],
      consequences: [t("Mcp.consequences.directoryRemoved")],
      warnings: [],
    };
  },
  async commit(ctx) {
    await deleteDirectoryEntry(ctx.principal.userId);
    return { data: { removed: true }, path: "/komunita/adresar" };
  },
});

export const COMMUNITY_ACTIONS = [
  rsvpEvent,
  clearEventRsvp,
  createPost,
  resolvePost,
  deletePost,
  setDirectory,
  removeDirectory,
];

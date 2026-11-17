import "server-only";

import { and, count, eq, gt, lte, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/db";
import { mcpPendingActions, oauthClients } from "@/db/schema";
import { isReadonly } from "@/lib/readonly";
import { assertActive, assertScopes } from "../authz";
import { McpError, toMcpError, validationError, type McpErrorCode } from "../errors";
import { randomToken, sha256Hex } from "../oauth/crypto";
import { ACCOUNTING_ACTIONS } from "./accounting";
import { appLink, translatorFor } from "./format";
import { BALLOT_ACTIONS } from "./ballot";
import { GOVERNANCE_ACTIONS } from "./governance";
import {
  isActionKind,
  type ActionContext,
  type ActionDef,
  type ActionKind,
  type ActionPreview,
  type AppLocale,
} from "./types";

// Pending action → human confirm (BYT-20261117-001 §5).
//
//   propose   authz + validation + preview, park the payload with a random
//             single-use token (SHA-256 stored), 10-minute expiry. Writes
//             NOTHING to business tables.
//   confirm   atomic claim (UPDATE … WHERE id AND user AND pending AND not
//             expired [AND token_hash] RETURNING) → re-run authz + validation
//             against the CURRENT state → commit through the lib function.
//             A miss is `action_expired` (or `forbidden` for another user's
//             action); state drift is `conflict.state_changed` with nothing
//             written.
//   cancel    same claim, status → cancelled.
//
// Two confirm paths:
//   - MCP App view: `confirm_action` (app-only tool) — OAuth principal +
//     the single-use confirm token.
//   - In-app fallback page: NextAuth session of the SAME user + action id.
//     No token: the session itself is the human-presence proof, and the page
//     only ever shows actions owned by that session's user.
//
// Expiry is lazy (no background job — multi-replica safe): a pending row
// past `expires_at` is treated as expired and flipped when touched.

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;
/** Max proposals per user per TTL window (§7). */
export const PENDING_ACTION_RATE_LIMIT = 10;

const ACTIONS: ReadonlyMap<ActionKind, ActionDef> = new Map(
  [...ACCOUNTING_ACTIONS, ...GOVERNANCE_ACTIONS, ...BALLOT_ACTIONS].map((a) => [a.kind, a])
);

export function getActionDef(kind: string): ActionDef | null {
  return isActionKind(kind) ? ACTIONS.get(kind) ?? null : null;
}

export function listActionDefs(): ActionDef[] {
  return [...ACTIONS.values()];
}

export type PendingActionRow = typeof mcpPendingActions.$inferSelect;
export type PendingStatus = PendingActionRow["status"];

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of exactly what will be written — must match at confirm. */
function payloadHash(kind: ActionKind, payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson({ kind, payload }));
}

function firstIssueField(error: z.ZodError): string {
  const key = error.issues[0]?.path?.[0];
  return typeof key === "string" ? key : "input";
}

/** Module + status + scope + schema + authz + state validation. */
async function checkAction(
  ctx: ActionContext,
  def: ActionDef,
  raw: unknown
): Promise<Record<string, unknown>> {
  assertActive(ctx.principal);
  assertScopes(ctx.principal, def.scopes);
  if (def.module && !ctx.enabledModules.has(def.module)) {
    throw new McpError("module_disabled", { module: def.module });
  }
  const parsed = def.schema.safeParse(raw ?? {});
  if (!parsed.success) throw validationError(firstIssueField(parsed.error));
  await def.authorize(ctx, parsed.data);
  return def.validate(ctx, parsed.data);
}

// ── propose ──────────────────────────────────────────────────────────────

export interface ProposeResult {
  actionId: string;
  confirmToken: string;
  preview: ActionPreview;
  expiresAt: Date;
  locale: AppLocale;
}

export async function proposeAction(
  ctx: ActionContext,
  kind: ActionKind,
  rawArgs: unknown,
  locale: AppLocale
): Promise<ProposeResult> {
  const def = getActionDef(kind);
  if (!def) throw new McpError("not_found");
  const payload = await checkAction(ctx, def, rawArgs);

  const [{ n }] = await db
    .select({ n: count() })
    .from(mcpPendingActions)
    .where(
      and(
        eq(mcpPendingActions.userId, ctx.principal.userId),
        gt(mcpPendingActions.createdAt, new Date(Date.now() - PENDING_ACTION_TTL_MS))
      )
    );
  if (n >= PENDING_ACTION_RATE_LIMIT) throw new McpError("rate_limited");

  const body = await def.preview(ctx, payload, locale);
  const preview: ActionPreview = { kind, locale, ...body };
  const confirmToken = randomToken(32);
  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);

  const [row] = await db
    .insert(mcpPendingActions)
    .values({
      userId: ctx.principal.userId,
      clientId: ctx.principal.clientId,
      kind,
      payload,
      preview: preview as unknown as Record<string, unknown>,
      previewHash: payloadHash(kind, payload),
      tokenHash: sha256Hex(confirmToken),
      status: "pending",
      locale,
      expiresAt,
    })
    .returning({ id: mcpPendingActions.id });

  return { actionId: row.id, confirmToken, preview, expiresAt, locale };
}

// ── decision (confirm / cancel) ──────────────────────────────────────────

/** How the human proved presence: the view's single-use token, or a web session. */
export type DecisionAuth = { via: "token"; token: string } | { via: "session" };

export interface DecisionOutcome {
  actionId: string;
  kind: ActionKind;
  status: "confirmed" | "cancelled";
  resultCode: "ok";
  locale: AppLocale;
  /** Localised one-line outcome for the human (view / page). */
  message: string;
  /** Absolute deep link to the created / changed record (confirm only). */
  url: string | null;
  data: Record<string, unknown>;
}

function claimWhere(actionId: string, userId: string, auth: DecisionAuth) {
  const base = [
    eq(mcpPendingActions.id, actionId),
    eq(mcpPendingActions.userId, userId),
    eq(mcpPendingActions.status, "pending"),
    gt(mcpPendingActions.expiresAt, sql`now()`),
  ];
  if (auth.via === "token") base.push(eq(mcpPendingActions.tokenHash, sha256Hex(auth.token)));
  return and(...base);
}

/**
 * Explains a failed claim. Another user's action → forbidden; anything else
 * (unknown id, wrong token, already decided, expired) → action_expired, so a
 * stale or replayed confirm never reveals which case it hit. A pending row
 * past its expiry is flipped to `expired` on the way.
 */
async function explainMiss(actionId: string, userId: string): Promise<McpError> {
  const [row] = await db
    .select({ userId: mcpPendingActions.userId })
    .from(mcpPendingActions)
    .where(eq(mcpPendingActions.id, actionId))
    .limit(1);
  if (row && row.userId !== userId) return new McpError("forbidden");
  if (row) {
    await expireIfDue(actionId);
    return new McpError("action_expired", { pendingActionId: actionId });
  }
  return new McpError("action_expired");
}

async function expireIfDue(actionId: string): Promise<void> {
  await db
    .update(mcpPendingActions)
    .set({ status: "expired", decidedAt: new Date(), resultCode: "action_expired" })
    .where(
      and(
        eq(mcpPendingActions.id, actionId),
        eq(mcpPendingActions.status, "pending"),
        lte(mcpPendingActions.expiresAt, sql`now()`)
      )
    );
}

async function markFailed(actionId: string, code: McpErrorCode): Promise<void> {
  await db
    .update(mcpPendingActions)
    .set({ status: "failed", resultCode: code.slice(0, 64) })
    .where(eq(mcpPendingActions.id, actionId));
}

/** Codes that keep their meaning at confirm time; everything else is drift. */
const CONFIRM_PASSTHROUGH = new Set<McpErrorCode>([
  "forbidden",
  "scope_required",
  "module_disabled",
  "unauthorized",
  "rate_limited",
]);

/**
 * A validation failure at confirm is a rule the proposal broke, not drift:
 * reporting it as "the data changed" sent users round in circles.
 */
function keepsMeaningAtConfirm(code: McpErrorCode): boolean {
  return CONFIRM_PASSTHROUGH.has(code) || code.startsWith("validation.");
}

export async function confirmAction(
  ctx: ActionContext,
  actionId: string,
  auth: DecisionAuth
): Promise<DecisionOutcome> {
  assertActive(ctx.principal);
  if (isReadonly()) throw new McpError("forbidden", { reason: "read_only" });

  const [claimed] = await db
    .update(mcpPendingActions)
    .set({ status: "confirmed", decidedAt: new Date() })
    .where(claimWhere(actionId, ctx.principal.userId, auth))
    .returning();
  if (!claimed) throw await explainMiss(actionId, ctx.principal.userId);

  const def = getActionDef(claimed.kind);
  const locale = (claimed.locale as AppLocale) ?? "sk";
  if (!def) {
    await markFailed(actionId, "internal");
    throw new McpError("internal", { pendingActionId: actionId });
  }

  // Re-run authz + validation against the CURRENT state: roles, module
  // status and the target record may all have changed since the proposal.
  let payload: Record<string, unknown>;
  try {
    payload = await checkAction(ctx, def, claimed.payload);
    if (payloadHash(def.kind, payload) !== claimed.previewHash) {
      throw new McpError("conflict.state_changed");
    }
  } catch (err) {
    const e = toMcpError(err);
    const code: McpErrorCode = keepsMeaningAtConfirm(e.code) ? e.code : "conflict.state_changed";
    await markFailed(actionId, code);
    throw new McpError(code, { pendingActionId: actionId, module: e.details?.module });
  }

  let committed;
  try {
    committed = await def.commit(ctx, payload, { actionId, locale });
  } catch (err) {
    const e = toMcpError(err);
    if (e.code === "internal") console.error(`[mcp] commit ${def.kind} ${actionId} failed:`, err);
    const code: McpErrorCode =
      e.code === "internal" || keepsMeaningAtConfirm(e.code) ? e.code : "conflict.state_changed";
    await markFailed(actionId, code);
    throw new McpError(code, { pendingActionId: actionId });
  }

  await db
    .update(mcpPendingActions)
    .set({ resultCode: "ok", result: { ...committed.data, path: committed.path } })
    .where(eq(mcpPendingActions.id, actionId));

  const t = await translatorFor(locale);
  return {
    actionId,
    kind: def.kind,
    status: "confirmed",
    resultCode: "ok",
    locale,
    message: t(`Mcp.actions.${def.kind}.done`),
    url: committed.path ? appLink(ctx, locale, committed.path) : null,
    data: committed.data,
  };
}

export async function cancelAction(
  ctx: Pick<ActionContext, "principal">,
  actionId: string,
  auth: DecisionAuth
): Promise<DecisionOutcome> {
  assertActive(ctx.principal);
  const [row] = await db
    .update(mcpPendingActions)
    .set({ status: "cancelled", decidedAt: new Date(), resultCode: "cancelled" })
    .where(claimWhere(actionId, ctx.principal.userId, auth))
    .returning({ kind: mcpPendingActions.kind, locale: mcpPendingActions.locale });
  if (!row) throw await explainMiss(actionId, ctx.principal.userId);

  const locale = (row.locale as AppLocale) ?? "sk";
  const t = await translatorFor(locale);
  return {
    actionId,
    kind: row.kind as ActionKind,
    status: "cancelled",
    resultCode: "ok",
    locale,
    message: t("Mcp.view.cancelledMessage"),
    url: null,
    data: {},
  };
}

// ── read (fallback page) ─────────────────────────────────────────────────

/**
 * The action as its owner sees it, or null for another user's / unknown id
 * (the page answers 404 — same as missing). A pending row past expiry is
 * reported (and stored) as expired.
 */
export async function getOwnPendingAction(
  actionId: string,
  userId: string
): Promise<PendingActionRow | null> {
  const [row] = await db
    .select()
    .from(mcpPendingActions)
    .where(and(eq(mcpPendingActions.id, actionId), eq(mcpPendingActions.userId, userId)))
    .limit(1);
  if (!row) return null;
  if (row.status === "pending" && row.expiresAt.getTime() <= Date.now()) {
    await expireIfDue(actionId);
    return { ...row, status: "expired", resultCode: "action_expired" };
  }
  return row;
}

/**
 * Fallback page lookup: the action for its owner, `forbidden` when it
 * belongs to someone else (AC: confirm by a different user → forbidden),
 * `missing` for an unknown id.
 */
export async function lookupPendingActionForUser(
  actionId: string,
  userId: string
): Promise<
  | { kind: "own"; row: PendingActionRow }
  | { kind: "forbidden" }
  | { kind: "missing" }
> {
  const own = await getOwnPendingAction(actionId, userId);
  if (own) return { kind: "own", row: own };
  const [other] = await db
    .select({ id: mcpPendingActions.id })
    .from(mcpPendingActions)
    .where(eq(mcpPendingActions.id, actionId))
    .limit(1);
  return other ? { kind: "forbidden" } : { kind: "missing" };
}

/** OAuth client display name for a stored client_id (audit justification). */
export async function clientDisplayName(clientId: string | null): Promise<string> {
  if (!clientId) return "web";
  const [row] = await db
    .select({ name: oauthClients.name })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row?.name ?? "AI app";
}

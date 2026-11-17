import "server-only";

import type { z } from "zod";

import type { CommunityRootRow } from "@/lib/legacy-compat";
import type { Principal, Scope } from "../principal";

// Pending-action framework types (BYT-20261117-001 §5). A write tool only
// PROPOSES an action; a human click commits it. Each action kind declares
// its scopes, authz, state checks, a human preview and the commit through
// the same lib function the UI route uses.

export const APP_LOCALES = ["sk", "en", "cs"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const ACTION_KINDS = [
  "match_payment",
  "record_payment",
  "post_expense_from_inbox",
  "dismiss_inbox_item",
  "submit_meter_reading",
  "approve_zavierka",
  "create_announcement",
  "draft_voting",
  "request_ballot_confirmation",
  "import_owners",
  "assign_unit_owner",
  "approve_registration",
  "reject_registration",
  "link_owner_account",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export function isActionKind(s: string): s is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(s);
}

/** Everything an action needs — built from an MCP token OR a web session. */
export interface ActionContext {
  principal: Principal;
  root: CommunityRootRow;
  enabledModules: ReadonlySet<string>;
  /** OAuth client display name ("MCP: <name>" audit justification). */
  clientName: string;
  /** Instance origin for deep links. */
  origin: string;
  numberLocale: "sk-SK" | "cs-CZ";
}

export interface PreviewRow {
  label: string;
  /** Plain value (no change). */
  value?: string;
  /** State before → after (balance, status, …). */
  before?: string;
  after?: string;
  /** Text authored by people / third parties (supplier, narrative, title). */
  untrusted?: boolean;
  /** Long text (announcement body) — rendered as a wrapped block. */
  multiline?: boolean;
}

/** Human-readable preview, rendered in the proposal's locale. */
export interface ActionPreview {
  kind: ActionKind;
  locale: AppLocale;
  title: string;
  /** One line, used in the model text summary and as the card subtitle. */
  summary: string;
  rows: PreviewRow[];
  /** What else happens on confirm (push to all residents, period closed …). */
  consequences: string[];
  /** Non-blocking warnings (reading lower than the previous one …). */
  warnings: string[];
  /**
   * Label of the confirm button when "Confirm" would mislead — e.g. the
   * ballot request, whose confirm only SENDS the confirmation email.
   */
  confirmLabel?: string;
  /** Localised outcome shown on the fallback page after confirm. */
  doneMessage?: string;
}

export interface CommitResult {
  /** Small machine-readable result (created ids). */
  data: Record<string, unknown>;
  /** App path (without origin / locale) to the created or changed record. */
  path: string | null;
}

/** Facts about the pending action the commit may need (audit links, email locale). */
export interface CommitMeta {
  actionId: string;
  locale: AppLocale;
}

export type Translator = (key: string, values?: Record<string, string | number>) => string;

export interface ActionDef<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: ActionKind;
  module?: "accounting" | "voting";
  /** Scopes the token must carry (always includes `read`). */
  scopes: readonly Scope[];
  /** JSON-safe payload schema (dates as ISO strings) — stored as-is. */
  schema: z.ZodType<P>;
  /** Role / board-role check; throws McpError("forbidden"). */
  authorize(ctx: ActionContext, payload: P): Promise<void> | void;
  /**
   * Validates the payload against CURRENT state (record exists, still
   * pending / unmatched, unit belongs to the dom …) and returns the
   * normalised payload. Throws McpError (validation.*, not_found,
   * conflict.state_changed). Run at propose AND again at confirm.
   */
  validate(ctx: ActionContext, payload: P): Promise<P>;
  preview(ctx: ActionContext, payload: P, locale: AppLocale): Promise<Omit<ActionPreview, "kind" | "locale">>;
  /** Writes through the shared lib function. Only ever called after a human click. */
  commit(ctx: ActionContext, payload: P, meta: CommitMeta): Promise<CommitResult>;
}

/** Erases the payload type for the heterogeneous registry. */
export function defineAction<P extends Record<string, unknown>>(def: ActionDef<P>): ActionDef {
  return def as unknown as ActionDef;
}

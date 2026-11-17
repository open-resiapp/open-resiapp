import "server-only";

import type { z } from "zod";

import type { CommunityRootRow } from "@/lib/legacy-compat";
import type { Principal, Scope } from "../principal";

// Tool framework types (BYT-20261117-001 §4). A tool declares its scopes,
// the module it belongs to, a role-visibility predicate and a zod input
// schema; `server.ts` turns the list into MCP registrations, filters
// tools/list per principal and wraps every call with authz + audit.

export interface ToolContext {
  principal: Principal;
  root: CommunityRootRow;
  /** Modules with status=enabled (60 s cache). */
  enabledModules: ReadonlySet<string>;
  /** Active owner membership on a unit of the dom (debtors / karta for owners). */
  isDomOwner: boolean;
  /** Display name of the OAuth client (audit justification). */
  clientName: string;
  /** Instance origin for deep links into the app. */
  origin: string;
  /** Number formatting locale for money strings. */
  numberLocale: "sk-SK" | "cs-CZ";
}

export interface ToolOutput {
  /** Short human summary → `content[0].text`. */
  summary: string;
  /** Machine-readable payload → `structuredContent`. */
  data: Record<string, unknown>;
  /**
   * Result `_meta` — handed to the MCP App view, never to the model
   * (confirm token, localised view labels).
   */
  meta?: Record<string, unknown>;
  /** Pending action proposed / decided by this call (audit, §7). */
  pendingActionId?: string;
}

/** MCP Apps tool `_meta.ui` (SEP-1865). */
export interface ToolUiMeta {
  /** `ui://` resource rendered for this tool's result. */
  resourceUri?: string;
  /** Default ["model", "app"]; ["app"] = callable by the view only. */
  visibility?: Array<"model" | "app">;
}

export type ToolModule = "accounting" | "voting";

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** English; first line is a complete sentence ≤200 chars. */
  description: string;
  scopes: readonly Scope[];
  module?: ToolModule;
  /**
   * Role / board-role visibility (module + active status are checked by the
   * framework). tools/list shows the tool only when this is true; a direct
   * call to a hidden tool returns `forbidden`.
   */
  visible: (ctx: ToolContext) => boolean;
  input: S;
  /**
   * Write tool: only PROPOSES a pending action (§5); the tool itself writes
   * no business table. Changes the advertised annotations.
   */
  proposes?: boolean;
  /** MCP Apps metadata (confirm view / app-only visibility). */
  ui?: ToolUiMeta;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolOutput>;
}

/** Erases the schema type for heterogeneous registries. */
export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

import "server-only";

import { z } from "zod";

import {
  isAccountingApprover,
  isAccountingWriter,
} from "@modules/accounting/src/lib/authz";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { isBoard } from "../authz";
import { resolveActionLocale } from "../actions/format";
import { presentProposal } from "../actions/present";
import { cancelAction, confirmAction, getActionDef, proposeAction } from "../actions/service";
import { APP_LOCALES, type ActionKind } from "../actions/types";
import { CONFIRM_VIEW_URI } from "../view/confirm-view";
import { uuidSchema } from "./helpers";
import { defineTool, type ToolContext, type ToolDef } from "./types";

// Write tools (BYT-20261117-001 §4 #23–#30) and the app-only decision tools
// (§5). A write tool runs authz + validation, parks a pending action and
// returns its preview — it NEVER writes a business table. The human click
// in the MCP App view calls `confirm_action` / `cancel_action` (visibility
// ["app"], single-use token); hosts without MCP Apps get an in-app link.

const isWriter = (ctx: ToolContext) =>
  isAccountingWriter(ctx.principal.role, ctx.principal.boardRoles);
const isApprover = (ctx: ToolContext) =>
  isAccountingApprover(ctx.principal.role, ctx.principal.boardRoles);

const CONFIRM_NOTE =
  "Only proposes: returns a preview the user must confirm with a click (in the app view or via the returned link). Nothing is written until then.";

interface WriteToolSpec {
  kind: ActionKind;
  title: string;
  /** First line complete sentence ≤200 chars. */
  description: string;
  visible: (ctx: ToolContext) => boolean;
}

const WRITE_TOOLS: readonly WriteToolSpec[] = [
  {
    kind: "match_payment",
    title: "Match a bank payment to a unit",
    description:
      "Proposes crediting an unmatched bank line to a unit (from list_unmatched_payments).\n" +
      "Treasurer or admin.",
    visible: isWriter,
  },
  {
    kind: "record_payment",
    title: "Record a payment",
    description:
      "Proposes recording a bank or cash payment received from a unit.\n" +
      "Treasurer or admin. Amount in cents.",
    visible: isWriter,
  },
  {
    kind: "post_expense_from_inbox",
    title: "Post an inbox invoice as an expense",
    description:
      "Proposes booking a scanned invoice from the expense inbox as an expense with supplier, amounts and VAT.\n" +
      "Treasurer or admin. Amounts in cents; netto + DPH must equal brutto.",
    visible: isWriter,
  },
  {
    kind: "dismiss_inbox_item",
    title: "Dismiss an inbox item",
    description:
      "Proposes dismissing a scan in the expense inbox that is not an invoice to book.\n" +
      "Treasurer or admin.",
    visible: isWriter,
  },
  {
    kind: "submit_meter_reading",
    title: "Submit a meter reading",
    description:
      "Proposes recording a meter reading (heat, water, electricity) for a unit.\n" +
      "Treasurer or admin for any unit; an owner for their own units. Value × 1000.",
    visible: (ctx) => isWriter(ctx) || ctx.isDomOwner,
  },
  {
    kind: "approve_zavierka",
    title: "Approve the annual accounts (závierka)",
    description:
      "Proposes closing an accounting year whose závierka was approved by a closed owners' vote.\n" +
      "Chairman or admin only — never the treasurer (separation of duties).",
    visible: isApprover,
  },
  {
    kind: "create_announcement",
    title: "Create an announcement",
    description:
      "Proposes publishing an announcement on the community board; it notifies residents by push.\n" +
      "Chairman, admin or caretaker.",
    visible: (ctx) => isBoard(ctx.principal, { allowCaretaker: true }),
  },
  {
    kind: "draft_voting",
    title: "Draft a voting",
    description:
      "Proposes creating a voting as a DRAFT with its ballot items, quorums and financial effects.\n" +
      "Chairman or admin. Activation happens only in the app.",
    visible: (ctx) => isBoard(ctx.principal),
  },
  {
    kind: "request_ballot_confirmation",
    title: "Request a ballot confirmation email",
    description:
      "Proposes the owner's ballot (a choice per item) for an active voting; after the owner approves, a confirmation email is sent.\n" +
      "Unit owners only. The vote is cast ONLY when the owner opens the emailed link (valid 30 min), signs in and confirms in the app — never by this tool.",
    visible: (ctx) => ctx.isDomOwner && hasPermission(ctx.principal.role as UserRole, "vote"),
  },
  {
    kind: "import_owners",
    title: "Import units and owners",
    description:
      "Proposes adding units and their owners to the current community from a table (e.g. an Excel the user shared).\n" +
      "Admin only. One row per (unit, owner); co-owners repeat the unit on their own row. Row keys:\n" +
      "- unit_number (required, text as in the land register)\n" +
      "- unit_floor (required, integer ≥ 0; 'prízemie' = 0)\n" +
      "- unit_share_numerator, unit_share_denominator (required, positive integers: the unit's share of the building, e.g. 1/96 → 1 and 96)\n" +
      "- unit_area_m2 (optional, m², decimals truncated)\n" +
      "- owner_name (required)\n" +
      "- owner_unit_share_numerator, owner_unit_share_denominator (required, positive integers: the owner's share of the unit; sole owner 1 and 1)\n" +
      "- owner_email, owner_phone, owner_address (optional)\n" +
      "- entrance_label (required for structure community_entrance_unit and community_block_entrance_unit), block_name (required for community_block_entrance_unit)\n" +
      "Do not send community-level columns (community_name, community_address, country sk|cz, voting_method per_share|per_flat|per_area): they are taken from the current community.\n" +
      "Rules: owner shares of each unit must sum to 1; unit shares of all units in the table must sum to 1 (send the whole building). " +
      "Units that already exist WITH owners are skipped with their rows; existing units without owners get the owners. " +
      "Owners are created without login (no invitation is sent); an e-mail of an existing account links that account. " +
      "Validation errors return {row, column, code}; fix the mapping and call again.",
    visible: (ctx) => hasPermission(ctx.principal.role as UserRole, "manageSettings"),
  },
  {
    kind: "assign_unit_owner",
    title: "Assign an owner to a unit",
    description:
      "Proposes making a person an owner of one unit with an ownership share (default 1/1).\n" +
      "Admin only. Give unitId (from list_units) and either userId (a person already in this community) or newOwner {name, email?, phone?} " +
      "(created without login, no invitation sent). The unit's owner shares must not exceed 1 in total.",
    visible: (ctx) => hasPermission(ctx.principal.role as UserRole, "manageUsers"),
  },
];

const localeArg = z
  .enum(APP_LOCALES)
  .optional()
  .describe("Language of the confirmation card (sk | en | cs); defaults to the community's language.");

function writeTool(spec: WriteToolSpec): ToolDef {
  const def = getActionDef(spec.kind);
  if (!def) throw new Error(`mcp: no action def for ${spec.kind}`);
  const input = (def.schema as unknown as z.ZodObject).extend({ locale: localeArg });
  return defineTool({
    name: spec.kind,
    title: spec.title,
    description: `${spec.description}\n${CONFIRM_NOTE}`,
    scopes: def.scopes,
    module: def.module,
    visible: spec.visible,
    input,
    proposes: true,
    ui: { resourceUri: CONFIRM_VIEW_URI },
    async run(args, ctx) {
      const { locale: requested, ...payload } = args as Record<string, unknown>;
      const locale = resolveActionLocale(requested, ctx.root);
      const proposal = await proposeAction(ctx, spec.kind, payload, locale);
      return presentProposal(ctx, proposal);
    },
  });
}

/** Persona has at least one write tool → it may need the decision tools. */
function hasAnyWriteTool(ctx: ToolContext): boolean {
  return WRITE_TOOLS.some((s) => {
    const def = getActionDef(s.kind);
    if (def?.module && !ctx.enabledModules.has(def.module)) return false;
    return s.visible(ctx);
  });
}

const decisionInput = z.object({
  actionId: uuidSchema.describe("Pending action id."),
  confirmToken: z.string().min(16).max(200).describe("Single-use confirm token from the proposal."),
});

const confirmActionTool = defineTool({
  name: "confirm_action",
  title: "Confirm a pending action",
  description:
    "Commits a pending action after the user clicked Confirm in the confirmation view.\n" +
    "App-only: callable by the confirmation view, never by the model.",
  scopes: ["read"],
  visible: hasAnyWriteTool,
  input: decisionInput,
  ui: { visibility: ["app"] },
  async run(args, ctx) {
    const out = await confirmAction(ctx, args.actionId, { via: "token", token: args.confirmToken });
    return {
      summary: out.url ? `${out.message}\n${out.url}` : out.message,
      data: { ...out },
      pendingActionId: out.actionId,
    };
  },
});

const cancelActionTool = defineTool({
  name: "cancel_action",
  title: "Cancel a pending action",
  description:
    "Cancels a pending action after the user clicked Cancel in the confirmation view.\n" +
    "App-only: callable by the confirmation view, never by the model.",
  scopes: ["read"],
  visible: hasAnyWriteTool,
  input: decisionInput,
  ui: { visibility: ["app"] },
  async run(args, ctx) {
    const out = await cancelAction(ctx, args.actionId, { via: "token", token: args.confirmToken });
    return { summary: out.message, data: { ...out }, pendingActionId: out.actionId };
  },
});

export const WRITE_TOOL_DEFS: ToolDef[] = WRITE_TOOLS.map(writeTool);
export const APP_ONLY_TOOLS: ToolDef[] = [confirmActionTool, cancelActionTool];

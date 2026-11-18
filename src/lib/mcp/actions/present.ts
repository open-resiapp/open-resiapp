import "server-only";

import { untrustedBlock } from "../tools/helpers";
import type { ToolOutput } from "../tools/types";
import { appLink, fmtDateTime, translatorFor } from "./format";
import type { ProposeResult } from "./service";
import type { ActionContext, ActionPreview, AppLocale, Translator } from "./types";

// How a proposed pending action is presented (BYT-20261117-001 §5):
//
//   content[0].text     localised summary + preview + the in-app fallback
//                       link (/<locale>/mcp/confirm/<id>) for hosts without
//                       MCP Apps.
//   structuredContent   what the model may see: action id, preview, expiry,
//                       fallback link. NEVER the confirm token.
//   _meta[VIEW_META]    what only the MCP App view gets: the single-use
//                       confirm token + localised view labels.

/** `_meta` key carrying the confirm view payload. */
export const VIEW_META_KEY = "resiapp/confirm";

/** Error codes the view / fallback page can show; anything else → generic. */
export const DECISION_ERROR_CODES = [
  "action_expired",
  "forbidden",
  "conflict.state_changed",
  "module_disabled",
  "scope_required",
  "rate_limited",
  "internal",
] as const;

/** Catalog key (under `Mcp.errors`) for a decision error code. */
export function decisionErrorKey(code: string): string {
  if ((DECISION_ERROR_CODES as readonly string[]).includes(code)) return code.replace(".", "_");
  if (code.startsWith("validation.")) return "validation";
  return "generic";
}

export function confirmPagePath(actionId: string): string {
  return `/mcp/confirm/${actionId}`;
}

export interface ViewLabels {
  confirm: string;
  cancel: string;
  working: string;
  expires: string;
  consequences: string;
  warnings: string;
  untrusted: string;
  openInApp: string;
  fallbackHint: string;
  confirmed: string;
  cancelled: string;
  errors: Record<string, string>;
}

async function viewLabels(t: Translator, expiresAt: Date, locale: AppLocale): Promise<ViewLabels> {
  const errors: Record<string, string> = {};
  for (const code of [...DECISION_ERROR_CODES, "validation", "generic"]) {
    const key = decisionErrorKey(code);
    errors[key] = t(`Mcp.errors.${key}`);
  }
  return {
    confirm: t("Mcp.view.confirm"),
    cancel: t("Mcp.view.cancel"),
    working: t("Mcp.view.working"),
    expires: t("Mcp.view.expires", { time: fmtDateTime(expiresAt, locale) }),
    consequences: t("Mcp.view.consequences"),
    warnings: t("Mcp.view.warnings"),
    untrusted: t("Mcp.view.untrusted"),
    openInApp: t("Mcp.view.openInApp"),
    fallbackHint: t("Mcp.view.fallbackHint"),
    confirmed: t("Mcp.view.confirmedTitle"),
    cancelled: t("Mcp.view.cancelledMessage"),
    errors,
  };
}

/** Plain-text preview for the model / hosts without MCP Apps. */
function previewText(preview: ActionPreview): string {
  const lines: string[] = [];
  const trusted: string[] = [];
  const untrusted: string[] = [];
  for (const r of preview.rows) {
    const value =
      r.before !== undefined || r.after !== undefined
        ? `${r.before ?? "—"} → ${r.after ?? "—"}`
        : (r.value ?? "—");
    (r.untrusted ? untrusted : trusted).push(`- ${r.label}: ${value}`);
  }
  lines.push(...trusted);
  if (untrusted.length > 0) lines.push(untrustedBlock(untrusted.join("\n"), "proposal"));
  for (const c of preview.consequences) lines.push(`! ${c}`);
  for (const w of preview.warnings) lines.push(`⚠ ${w}`);
  return lines.join("\n");
}

export async function presentProposal(
  ctx: Pick<ActionContext, "origin"> & { appsUi?: boolean },
  r: ProposeResult
): Promise<ToolOutput> {
  // The confirm token goes only to hosts that render the MCP App view
  // (they keep result `_meta` away from the model). Anyone else gets the
  // in-app confirm link only; confirm_action without a token is rejected.
  const withToken = ctx.appsUi === true;
  const t = await translatorFor(r.locale);
  const confirmUrl = appLink(ctx, r.locale, confirmPagePath(r.actionId));
  const expiresAt = r.expiresAt.toISOString();

  const summary = [
    t("Mcp.view.pendingText", { summary: r.preview.summary }),
    previewText(r.preview),
    // "In the card below" only where a card is actually rendered.
    t(withToken ? "Mcp.view.fallbackText" : "Mcp.view.fallbackTextLinkOnly", {
      url: confirmUrl,
      time: fmtDateTime(r.expiresAt, r.locale),
    }),
  ].join("\n\n");

  return {
    summary,
    data: {
      status: "pending_confirmation",
      actionId: r.actionId,
      kind: r.preview.kind,
      expiresAt,
      confirmUrl,
      preview: r.preview,
      note: withToken
        ? "Nothing has been written. The user must confirm in the app view or at confirmUrl; you cannot confirm on their behalf."
        : "Nothing has been written. Send the user confirmUrl; they confirm or cancel there in the app. You cannot confirm on their behalf.",
    },
    meta: {
      [VIEW_META_KEY]: {
        actionId: r.actionId,
        ...(withToken ? { confirmToken: r.confirmToken } : {}),
        locale: r.locale,
        expiresAt,
        confirmUrl,
        preview: r.preview,
        labels: await viewLabels(t, r.expiresAt, r.locale),
      },
    },
    pendingActionId: r.actionId,
  };
}

"use server";

import { notFound, redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { cancelAction, confirmAction, lookupPendingActionForUser } from "@/lib/mcp/actions/service";
import { actionContextFromSession } from "@/lib/mcp/actions/session";
import { logMcpCall } from "@/lib/mcp/audit";
import { toMcpError } from "@/lib/mcp/errors";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import { assertWritable } from "@/lib/readonly";

// In-app fallback decision (BYT-20261117-001 §5 step 5). The NextAuth
// session of the SAME user is the human-presence proof (no token); the
// service re-runs authz + validation and commits through the same lib
// function as the MCP App path. One mcp_audit_log row per decision.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeLocale(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return (routing.locales as readonly string[]).includes(s) ? s : routing.defaultLocale;
}

export async function decidePendingAction(formData: FormData): Promise<void> {
  assertWritable();
  if (!(await isMcpEnabled())) notFound();

  const locale = safeLocale(formData.get("locale"));
  const actionId = String(formData.get("actionId") ?? "");
  if (!UUID_RE.test(actionId)) notFound();
  const pagePath = `/${locale}/mcp/confirm/${actionId}`;

  const session = await auth();
  if (!session) redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(pagePath)}`);

  const decision = formData.get("decision") === "confirm" ? "confirm" : "cancel";
  const found = await lookupPendingActionForUser(actionId, session.user.id);
  if (found.kind === "missing") notFound();

  const started = Date.now();
  let code = "ok";
  const clientId = found.kind === "own" ? found.row.clientId : null;
  if (found.kind === "forbidden") {
    code = "forbidden";
  } else {
    try {
      const ctx = await actionContextFromSession(session, clientId);
      if (decision === "confirm") await confirmAction(ctx, actionId, { via: "session" });
      else await cancelAction(ctx, actionId, { via: "session" });
    } catch (err) {
      const e = toMcpError(err);
      if (e.code === "internal") console.error("[mcp] web decision failed:", err);
      code = e.code;
    }
  }

  logMcpCall({
    userId: session.user.id,
    clientId,
    tool: `web:${decision}_action`,
    args: { actionId },
    resultCode: code,
    durationMs: Date.now() - started,
    pendingActionId: found.kind === "own" ? actionId : null,
  });

  redirect(code === "ok" ? pagePath : `${pagePath}?e=${encodeURIComponent(code)}`);
}

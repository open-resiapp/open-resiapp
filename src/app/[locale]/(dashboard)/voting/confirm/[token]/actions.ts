"use server";

import { notFound, redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { logMcpCall } from "@/lib/mcp/audit";
import { assertActive } from "@/lib/mcp/authz";
import { toMcpError } from "@/lib/mcp/errors";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import { principalFromSession } from "@/lib/mcp/principal";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { checkRateLimitKey, RATE_LIMITS } from "@/lib/rate-limiter";
import { assertWritable } from "@/lib/readonly";
import {
  cancelPendingBallot,
  confirmPendingBallot,
  isPendingBallotToken,
  lookupPendingBallot,
} from "@modules/voting/src/pending-ballots";

// Email-link ballot decision (BYT-20261117-001 §6 step 3). The token binds
// the ballot, the NextAuth session binds the person — both must be the
// same owner (Decided 3). "confirm" is the ONLY place an MCP-originated
// ballot reaches mod_voting_ballots (confirmationKind='email'); "cancel"
// kills the request and casts nothing. One mcp_audit_log row per decision.

function safeLocale(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return (routing.locales as readonly string[]).includes(s) ? s : routing.defaultLocale;
}

export async function decidePendingBallot(formData: FormData): Promise<void> {
  assertWritable();
  if (!(await isModuleEnabled("voting")) || !(await isMcpEnabled())) notFound();

  const locale = safeLocale(formData.get("locale"));
  const token = String(formData.get("token") ?? "");
  if (!isPendingBallotToken(token)) notFound();
  const pagePath = `/${locale}/voting/confirm/${token}`;

  const session = await auth();
  if (!session) redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(pagePath)}`);

  const decision = formData.get("decision") === "confirm" ? "confirm" : "cancel";
  const started = Date.now();
  const found = await lookupPendingBallot(token, session.user.id);
  const own = found.kind === "own" ? found.row : null;

  let code = "ok";
  let ballotId: string | null = null;
  if (checkRateLimitKey(`u:${session.user.id}`, RATE_LIMITS.ballotConfirm, "ballotConfirm") !== null) {
    code = "rate_limited";
  } else {
    try {
      const principal = await principalFromSession(session);
      assertActive(principal);
      if (decision === "confirm") {
        ballotId = (await confirmPendingBallot(principal, token)).ballotId;
      } else {
        await cancelPendingBallot(principal, token);
      }
    } catch (err) {
      const e = toMcpError(err);
      if (e.code === "internal") console.error("[voting] ballot email-link decision failed:", err);
      code = e.code;
    }
  }

  logMcpCall({
    userId: session.user.id,
    clientId: own?.clientId ?? null,
    tool: `web:${decision}_ballot`,
    args: {
      pendingBallotId: own?.id ?? null,
      votingId: own?.votingId ?? null,
      ballotId,
    },
    resultCode: code,
    durationMs: Date.now() - started,
    pendingActionId: own?.pendingActionId ?? null,
  });

  redirect(code === "ok" ? pagePath : `${pagePath}?e=${encodeURIComponent(code)}`);
}

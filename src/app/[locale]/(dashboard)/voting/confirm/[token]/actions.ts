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

// Email-link ballot decision (BYT-20261117-001 §6 step 3) — the ONE e-mail
// confirmation path for web and MCP ballots (BYT-20261118-009). The token
// binds the ballot, the NextAuth session binds the person — both must be
// the same owner (Decided 3). "confirm" is the ONLY place an e-mail-
// confirmed ballot reaches mod_voting_ballots (confirmationKind='email');
// "cancel" kills the request and casts nothing. An MCP-originated request
// also writes one mcp_audit_log row per decision; a web request's audit
// record is its pending row. An MCP request is decidable only while the
// MCP module is enabled.

function safeLocale(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return (routing.locales as readonly string[]).includes(s) ? s : routing.defaultLocale;
}

export async function decidePendingBallot(formData: FormData): Promise<void> {
  assertWritable();
  if (!(await isModuleEnabled("voting"))) notFound();

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
  if (own?.source === "mcp" && !(await isMcpEnabled())) notFound();

  let code = "ok";
  let ballotId: string | null = null;
  let passkeyActivated = false;
  if (checkRateLimitKey(`u:${session.user.id}`, RATE_LIMITS.ballotConfirm, "ballotConfirm") !== null) {
    code = "rate_limited";
  } else {
    try {
      const principal = await principalFromSession(session);
      assertActive(principal);
      if (decision === "confirm") {
        const confirmed = await confirmPendingBallot(principal, token);
        ballotId = confirmed.ballotId;
        passkeyActivated = confirmed.passkeyActivated;
      } else {
        await cancelPendingBallot(principal, token);
      }
    } catch (err) {
      const e = toMcpError(err);
      if (e.code === "internal") console.error("[voting] ballot email-link decision failed:", err);
      code = e.code;
    }
  }

  if (own?.source !== "web") {
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
  }

  redirect(
    code !== "ok"
      ? `${pagePath}?e=${encodeURIComponent(code)}`
      : passkeyActivated
        ? `${pagePath}?pk=1`
        : pagePath
  );
}

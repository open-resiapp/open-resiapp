import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { sendBallotConfirmation } from "@/lib/email";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { validateBallotCast, VALID_CHOICES } from "@modules/voting/src/ballots";
import {
  createPendingBallot,
  describeBallot,
  hasExistingBallot,
  markPendingBallotFailed,
  PENDING_BALLOT_TTL_MS,
  shortBallotHash,
} from "@modules/voting/src/pending-ballots";
import { McpError } from "../errors";
import { appLink, fmtDate, translatorFor } from "./format";
import { defineAction, type PreviewRow, type Translator } from "./types";

// #31 request_ballot_confirmation (BYT-20261117-001 §6).
//
// The model proposes an owner's ballot; the owner sees every item + choice
// in the confirm view (or fallback page). The confirm button there only
// SENDS the confirmation email (it does not cast): commit parks the ballot
// in mod_voting_pending_ballots and emails a single-use 30-minute link.
// The vote is cast only on /<locale>/voting/confirm/<token>, signed in as
// the same owner, by an explicit "I confirm my vote" click. This action
// never writes mod_voting_ballots.

const CHOICE_KEY: Record<string, string> = {
  za: "Mcp.preview.choice_za",
  proti: "Mcp.preview.choice_proti",
  zdrzal_sa: "Mcp.preview.choice_zdrzal_sa",
};

function choiceLabel(t: Translator, choice: string | null): string {
  return choice ? t(CHOICE_KEY[choice] ?? "Mcp.preview.choice_unmarked") : t("Mcp.preview.choice_unmarked");
}

/** "jan.novak@x.sk" → "j***@x.sk" — the preview also reaches the model. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

async function ownerContact(userId: string): Promise<{ email: string; name: string }> {
  const [u] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.email) throw new McpError("forbidden", { reason: "no_email" });
  return { email: u.email, name: u.name };
}

const choiceSchema = z.enum(VALID_CHOICES as [string, ...string[]]);

export const ballotRequestSchema = z.object({
  votingId: z.string().uuid().describe("Active voting id (from list_votings)."),
  unitId: z.string().uuid().describe("The owner's unit (from whoami)."),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid().describe("Ballot item id (from get_voting)."),
        choice: choiceSchema.describe("za (for) | proti (against) | zdrzal_sa (abstain)."),
      })
    )
    .min(1)
    .max(100)
    .describe("The owner's choice per item; unlisted items stay unmarked."),
});

type BallotPayload = z.infer<typeof ballotRequestSchema> & { ballotHash?: string };

const requestBallotConfirmation = defineAction<BallotPayload>({
  kind: "request_ballot_confirmation",
  module: "voting",
  scopes: ["read", "vote"],
  schema: ballotRequestSchema as unknown as z.ZodType<BallotPayload>,
  authorize(ctx) {
    if (!hasPermission(ctx.principal.role as UserRole, "vote")) {
      throw new McpError("forbidden");
    }
  },
  async validate(ctx, p) {
    // voting active, electronic allowed (meeting / SK owners-quarter →
    // electronic_blocked), active OWNER membership, unit in scope, valid
    // items + choices. Writes nothing.
    const v = await validateBallotCast(ctx.principal, {
      votingId: p.votingId,
      unitId: p.unitId,
      items: p.items,
      requireOwnerMembership: true,
    });
    await ownerContact(ctx.principal.userId);
    return {
      votingId: v.votingId,
      unitId: v.unitId,
      items: v.marked.map((m) => ({ itemId: m.itemId, choice: m.choice })),
      ballotHash: v.ballotHash,
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const [desc, contact, existing] = await Promise.all([
      describeBallot(p.votingId, p.unitId, p.items as { itemId: string; choice: "za" | "proti" | "zdrzal_sa" }[]),
      ownerContact(ctx.principal.userId),
      hasExistingBallot(p.votingId, p.unitId, ctx.principal.userId),
    ]);
    if (!desc) throw new McpError("not_found");
    const itemRows: PreviewRow[] = desc.items.map((it, i) => ({
      label: t("Mcp.preview.itemN", { n: i + 1 }),
      value: `${it.title} — ${choiceLabel(t, it.choice)}`,
      untrusted: true,
    }));
    const unmarked = desc.items.filter((it) => it.choice === null).length;
    const minutes = Math.round(PENDING_BALLOT_TTL_MS / 60000);
    return {
      title: t("Mcp.actions.request_ballot_confirmation.title"),
      summary: t("Mcp.actions.request_ballot_confirmation.summary", { title: desc.votingTitle }),
      rows: [
        { label: t("Mcp.preview.votingTitle"), value: desc.votingTitle, untrusted: true },
        { label: t("Mcp.preview.unit"), value: desc.unitName },
        { label: t("Mcp.preview.endsAt"), value: fmtDate(desc.votingEndsAt, locale) },
        ...itemRows,
        { label: t("Mcp.preview.ballotHash"), value: shortBallotHash(p.ballotHash ?? "") },
        { label: t("Mcp.preview.emailTo"), value: maskEmail(contact.email) },
      ],
      consequences: [
        t("Mcp.consequences.ballotNotCastYet"),
        t("Mcp.consequences.ballotEmailSent", { minutes }),
        t("Mcp.consequences.ballotConfirmSignedIn"),
      ],
      warnings: [
        ...(existing ? [t("Mcp.warnings.ballotReplacesExisting")] : []),
        ...(unmarked > 0 ? [t("Mcp.warnings.ballotUnmarkedItems", { count: unmarked })] : []),
      ],
      confirmLabel: t("Mcp.actions.request_ballot_confirmation.confirmLabel"),
      doneMessage: t("Mcp.actions.request_ballot_confirmation.done"),
    };
  },
  async commit(ctx, p, meta) {
    const marked = p.items as { itemId: string; choice: "za" | "proti" | "zdrzal_sa" }[];
    const ballotHash = p.ballotHash ?? "";
    const [desc, contact] = await Promise.all([
      describeBallot(p.votingId, p.unitId, marked),
      ownerContact(ctx.principal.userId),
    ]);
    if (!desc) throw new McpError("conflict.state_changed");

    const created = await createPendingBallot(
      {
        votingId: p.votingId,
        unitId: p.unitId,
        ownerId: ctx.principal.userId,
        marked,
        ballotHash,
      },
      { clientId: ctx.principal.clientId, pendingActionId: meta.actionId, locale: meta.locale }
    );

    const sent = await sendBallotConfirmation({
      recipientEmail: contact.email,
      recipientName: contact.name,
      votingTitle: desc.votingTitle,
      unitName: desc.unitName,
      clientName: ctx.clientName,
      items: desc.items.map((it, i) => ({ n: i + 1, title: it.title, choice: it.choice })),
      shortHash: shortBallotHash(ballotHash),
      confirmUrl: appLink(ctx, meta.locale, `/voting/confirm/${created.token}`),
      expiryMinutes: Math.round(PENDING_BALLOT_TTL_MS / 60000),
      locale: meta.locale,
    });
    if (!sent) {
      await markPendingBallotFailed(created.id, "email_failed");
      throw new McpError("internal", { reason: "email_failed" });
    }

    return {
      data: {
        pendingBallotId: created.id,
        expiresAt: created.expiresAt.toISOString(),
        emailSentTo: maskEmail(contact.email),
        ballotHashShort: shortBallotHash(ballotHash),
      },
      path: `/voting/${p.votingId}`,
    };
  },
});

export const BALLOT_ACTIONS = [requestBallotConfirmation];

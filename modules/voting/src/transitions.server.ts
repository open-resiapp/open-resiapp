import "server-only";
// BYT-20261118-002 §6 — executes a voting status transition. The pure rules
// live in ./workflow/transitions.ts (state machine) and ./workflow/notice.ts
// (statutory lead time). Authz is the caller's job (assertBoard in the route).
//
// Concurrency: one short transaction — the voting row is locked FOR UPDATE,
// the state machine re-checked on the locked row, then the guarded UPDATE and
// the event INSERT. Two tabs / two replicas closing at once: the second one
// waits on the row lock, then sees `closed` and gets TRANSITION_NOT_ALLOWED,
// so exactly one `closed` event is written. Lock order matches the cast path
// (voting row first), see routes/api/ballots/cast.server.ts.
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { timeZoneForCountry } from "@/lib/time-zone";
import type { Country, VotingStatus } from "@/types";
import { votingEvents, votings } from "./db/schema";
import { recordVotingEvent, type VotingEventKind } from "./events";
import { clearVotingFreeze, freezeVotingAtClose } from "./freeze.server";
import { validatePerRollamDuration } from "./rules";
import { minutesHistory } from "./workflow/minutes";
import {
  checkTransition,
  type TransitionErrorCode,
  type VotingAction,
} from "./workflow/transitions";
import { validateNotice, type NoticeErrorCode } from "./workflow/notice";

export type TransitionFailureCode =
  | TransitionErrorCode
  | NoticeErrorCode
  | "NOT_FOUND"
  // CZ §1211 per rollam minimum term (rules/validatePerRollamDuration),
  // re-checked on announce: a draft PATCH of endsAt is not validated.
  | "PER_ROLLAM_TOO_SHORT";

export type TransitionResult =
  | { ok: true; voting: typeof votings.$inferSelect; action: VotingAction }
  | { ok: false; code: TransitionFailureCode; status: number; minDate?: string };

const EVENT_FOR_ACTION: Record<VotingAction, VotingEventKind> = {
  announce: "announced",
  close: "closed",
  reopen: "reopened",
  publish: "result_published",
};

class Abort extends Error {
  constructor(
    readonly code: TransitionFailureCode,
    readonly status: number,
    readonly minDate?: string
  ) {
    super(code);
  }
}

export async function transitionVoting(input: {
  votingId: string;
  actorId: string;
  action: VotingAction;
  note?: string | null;
  /** publish only: the day the result was published (defaults to now). */
  publishedAt?: Date | null;
}): Promise<TransitionResult> {
  const { votingId, actorId, action } = input;
  const note = typeof input.note === "string" ? input.note.trim() : null;

  // Country / time zone are read outside the transaction (cheap, no lock).
  let country: Country = "sk";
  if (action === "announce") {
    const root = await getCommunityRoot();
    country = (root?.country ?? "sk") as Country;
  }

  try {
    const voting = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(votings)
        .where(eq(votings.id, votingId))
        .limit(1)
        .for("update");
      if (!current) throw new Abort("NOT_FOUND", 404);

      const check = checkTransition(
        {
          status: current.status as VotingStatus,
          resultPublishedAt: current.resultPublishedAt,
          endsAt: current.endsAt,
        },
        action,
        { note, publishedAt: input.publishedAt ?? null }
      );
      if (!check.ok) {
        throw new Abort(check.code, check.code === "TRANSITION_NOT_ALLOWED" ? 409 : 400);
      }

      const now = new Date();
      const set: Partial<typeof votings.$inferInsert> = { status: check.to };
      if (action === "announce") {
        const noticeError = validateNotice({
          country,
          announcedAt: now,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          timeZone: timeZoneForCountry(country),
        });
        if (noticeError) throw new Abort(noticeError.code, 400, noticeError.minDate);
        if (current.votingType === "written") {
          const minEnd = validatePerRollamDuration(country, current.startsAt, current.endsAt);
          if (minEnd) {
            throw new Abort("PER_ROLLAM_TOO_SHORT", 400, minEnd.toISOString().split("T")[0]);
          }
        }
        // Set once: a later reopen never moves the announcement.
        if (!current.announcedAt) set.announcedAt = now;
      }
      if (action === "publish") set.resultPublishedAt = input.publishedAt ?? now;

      const [updated] = await tx
        .update(votings)
        .set(set)
        .where(and(eq(votings.id, votingId), eq(votings.status, current.status)))
        .returning();
      if (!updated) throw new Abort("TRANSITION_NOT_ALLOWED", 409);

      // 2026-11-18 review: freeze on close, unfreeze on reopen (same tx, the
      // voting row is locked FOR UPDATE — no ballot can change meanwhile).
      let payload: Record<string, unknown> | null = null;
      if (action === "close") await freezeVotingAtClose(tx, updated);
      if (action === "reopen") {
        await clearVotingFreeze(tx, votingId);
        // Spec §6: minutes generated before the reopen are superseded. The
        // marker lives on the append-only `reopened` event; minutesHistory()
        // derives the same flag for the history list.
        const history = await tx
          .select({ kind: votingEvents.kind, payload: votingEvents.payload, createdAt: votingEvents.createdAt })
          .from(votingEvents)
          .where(eq(votingEvents.votingId, votingId))
          .orderBy(asc(votingEvents.createdAt));
        const superseded = minutesHistory(history)
          .filter((m) => !m.superseded)
          .map((m) => m.version);
        if (superseded.length > 0) payload = { supersededMinutes: superseded };
      }
      if (action === "publish") {
        payload = { publishedAt: (set.resultPublishedAt as Date).toISOString() };
      }

      await recordVotingEvent(tx, {
        votingId,
        kind: EVENT_FOR_ACTION[action],
        actorId,
        note: action === "reopen" ? note : null,
        payload,
      });
      return updated;
    });
    return { ok: true, voting, action };
  } catch (err) {
    if (err instanceof Abort) {
      return err.minDate
        ? { ok: false, code: err.code, status: err.status, minDate: err.minDate }
        : { ok: false, code: err.code, status: err.status };
    }
    throw err;
  }
}

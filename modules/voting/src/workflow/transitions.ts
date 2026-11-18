// BYT-20261118-002 §6 — voting status state machine. Pure: no DB, no i18n;
// returns stable codes (UI maps them to VotingWorkflow.errors.*).
//
//   announce: draft  → active   (first activation = announcement)
//   close:    active → closed
//   reopen:   closed → active   ONLY while the result is unpublished and with
//                               a written note (DECIDED, Filip 2026-11-18)
//   publish:  closed → closed   sets result_published_at (§14a ods. 9);
//                               afterwards reopen is refused — a correction
//                               then needs a new voting (§14b ods. 6).
// Everything else → TRANSITION_NOT_ALLOWED.
import type { VotingStatus } from "@/types";

export type VotingAction = "announce" | "close" | "reopen" | "publish";

export const VOTING_ACTIONS: VotingAction[] = ["announce", "close", "reopen", "publish"];

export type TransitionErrorCode =
  | "TRANSITION_NOT_ALLOWED"
  | "REOPEN_NOTE_REQUIRED"
  | "RESULT_ALREADY_PUBLISHED"
  | "PUBLISH_DATE_INVALID";

/** Minimum length of the reopen note (docs/domain/voting.md invariant). */
export const REOPEN_NOTE_MIN = 10;

export interface TransitionState {
  status: VotingStatus;
  resultPublishedAt: Date | null;
}

export type TransitionCheck =
  | { ok: true; to: VotingStatus }
  | { ok: false; code: TransitionErrorCode };

export function checkTransition(
  state: TransitionState,
  action: VotingAction,
  opts: { note?: string | null; publishedAt?: Date | null; now?: Date } = {}
): TransitionCheck {
  switch (action) {
    case "announce":
      return state.status === "draft"
        ? { ok: true, to: "active" }
        : { ok: false, code: "TRANSITION_NOT_ALLOWED" };
    case "close":
      return state.status === "active"
        ? { ok: true, to: "closed" }
        : { ok: false, code: "TRANSITION_NOT_ALLOWED" };
    case "reopen":
      if (state.status !== "closed") return { ok: false, code: "TRANSITION_NOT_ALLOWED" };
      if (state.resultPublishedAt) return { ok: false, code: "RESULT_ALREADY_PUBLISHED" };
      if ((opts.note ?? "").trim().length < REOPEN_NOTE_MIN) {
        return { ok: false, code: "REOPEN_NOTE_REQUIRED" };
      }
      return { ok: true, to: "active" };
    case "publish": {
      if (state.status !== "closed") return { ok: false, code: "TRANSITION_NOT_ALLOWED" };
      if (state.resultPublishedAt) return { ok: false, code: "RESULT_ALREADY_PUBLISHED" };
      const now = opts.now ?? new Date();
      if (opts.publishedAt) {
        const t = opts.publishedAt.getTime();
        if (Number.isNaN(t) || t > now.getTime()) {
          return { ok: false, code: "PUBLISH_DATE_INVALID" };
        }
      }
      return { ok: true, to: "closed" };
    }
    default:
      return { ok: false, code: "TRANSITION_NOT_ALLOWED" };
  }
}

/**
 * Legacy `PATCH { status }` bodies mapped to an action, for older clients.
 * `active` from `closed` is a reopen (and therefore needs a note).
 */
export function actionForLegacyStatus(
  current: VotingStatus,
  requested: unknown
): VotingAction | null {
  if (requested === "closed") return "close";
  if (requested === "active") return current === "closed" ? "reopen" : "announce";
  return null;
}

/** §14a ods. 9: result + minutes must be published within 7 days after the end. */
export const PUBLICATION_DEADLINE_DAYS = 7;

export function publicationDeadline(endsAt: Date): Date {
  return new Date(endsAt.getTime() + PUBLICATION_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
}

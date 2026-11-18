// Stable server codes the voting UI maps to VotingWorkflow.errors.* (wizard
// "Nové hlasovanie" and the board WorkflowPanel). Pure, client-safe — the
// pages import this set instead of keeping their own copies, so a new server
// code cannot be added without a catalog key (2026-11-18 review).
export const VOTING_WORKFLOW_ERROR_CODES = [
  "TRANSITION_NOT_ALLOWED",
  "REOPEN_NOTE_REQUIRED",
  "RESULT_ALREADY_PUBLISHED",
  "PUBLISH_DATE_INVALID",
  "PUBLISH_BEFORE_END",
  "NOTICE_LEAD_TIME_TOO_SHORT",
  "NOTICE_START_AFTER_END",
  "NOTICE_VERIFIERS_REQUIRED",
  "OFFICIALS_INVALID",
  "VOTING_LOCKED",
  "ENDS_AT_ONLY_LATER",
  "REPEAT_ESCALATION_UNSUPPORTED",
  "REPEAT_ESCALATION_NOT_APPLICABLE",
  "QUORUM_NOT_ALLOWED",
  "QUORUM_TYPE_INVALID",
  "PER_ROLLAM_TOO_SHORT",
  "MINUTES_NOT_AVAILABLE",
  "PAPER_PHOTO_REQUIRED",
  "BALLOT_CONFLICT",
] as const;

export type VotingWorkflowErrorCode = (typeof VOTING_WORKFLOW_ERROR_CODES)[number];

export const VOTING_WORKFLOW_ERRORS: ReadonlySet<string> = new Set(VOTING_WORKFLOW_ERROR_CODES);

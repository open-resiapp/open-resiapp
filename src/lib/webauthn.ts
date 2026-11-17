// BYT-20261117-002 Phase 6: client-safe passkey types and constants.
// Server logic lives in webauthn.server.ts.

/** A registered passkey as shown in the profile list. */
export interface PasskeySummary {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** null = registered but not yet confirmed by the e-mail link (cannot confirm votes). */
  activatedAt: string | null;
}

/** Stable error codes returned by the passkey routes (mapped to Passkeys.errors.*). */
export const PASSKEY_ERROR_CODES = [
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "RATE_LIMITED",
  "CONFIRMATION_UNAVAILABLE",
  "CHALLENGE_INVALID",
  "CHALLENGE_EXPIRED",
  "REGISTRATION_FAILED",
  "PASSKEY_ALREADY_REGISTERED",
  "PASSKEY_NOT_FOUND",
  "PASSKEY_ALREADY_ACTIVE",
  "ACTIVATION_INVALID",
  "ACTIVATION_EXPIRED",
  "NO_EMAIL",
  "EMAIL_UNAVAILABLE",
] as const;
export type PasskeyErrorCode = (typeof PASSKEY_ERROR_CODES)[number];

/** Passkey vote challenge lifetime. */
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** E-mail confirmation link lifetime. */
export const EMAIL_CONFIRMATION_TTL_MS = 30 * 60 * 1000;
/** Passkey activation link lifetime. */
export const PASSKEY_ACTIVATION_TTL_MS = 30 * 60 * 1000;
/** Longest lifetime of any vote / withdraw confirmation token (revocation markers outlive it). */
export const MAX_VOTE_TOKEN_TTL_MS = Math.max(
  EMAIL_CONFIRMATION_TTL_MS,
  PASSKEY_CHALLENGE_TTL_MS
);

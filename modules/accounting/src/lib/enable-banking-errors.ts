// Enable Banking connector error codes (BYT-20261118-001). Client-safe —
// no imports — so the UI can validate a code before translating it via
// `Accounting.reconciliation.ebErrors.<code>`.

export const EB_ERROR_CODES = [
  "EB_NOT_CONFIGURED",
  "EB_NOT_CONNECTED",
  "EB_ACCOUNT_NOT_SELECTED",
  "EB_UNKNOWN_ACCOUNT",
  "EB_UNKNOWN_BANK",
  "EB_CONSENT_EXPIRED",
  "EB_RATE_LIMITED",
  "EB_API_ERROR",
  "EB_STATE_MISMATCH",
  "EB_AUTH_REJECTED",
  "EB_INVALID_PAYLOAD",
  "EB_INVALID_AMOUNT",
  "EB_CURRENCY_MISMATCH",
] as const;

export type EnableBankingErrorCode = (typeof EB_ERROR_CODES)[number];

export class EnableBankingError extends Error {
  constructor(
    public readonly code: EnableBankingErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "EnableBankingError";
  }
}

export function isEnableBankingErrorCode(
  value: unknown
): value is EnableBankingErrorCode {
  return (
    typeof value === "string" &&
    (EB_ERROR_CODES as readonly string[]).includes(value)
  );
}

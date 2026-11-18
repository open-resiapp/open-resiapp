// Client-safe helpers for the short code printed on paper claim letters.
// (Generation lives in invitations.ts — it needs node crypto / server-only.)

// No 0/O/1/I/L — the code is typed from paper by older owners.
export const SHORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SHORT_CODE_LENGTH = 10;

/** "ABCDE-FGHJK" for display; normalizeShortCode() reverses it. */
export function formatShortCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function normalizeShortCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

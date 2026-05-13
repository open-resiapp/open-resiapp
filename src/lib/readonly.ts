// Runtime read-only mode (BYT-20260513-004).
//
// Cloud platform flips `IS_READONLY=true` on an already-running instance via
// task definition restart when a sandbox trial expires (7-day grace before
// destruction). All write APIs return 423 Locked; reads behave normally so
// the customer can review their data before promoting or letting it expire.
//
// Keep this module client-safe: it must NOT import next/headers, cookies(),
// or any DB driver. The banner component and middleware both read it; the
// banner is rendered server-side from the locale layout.

/** True when the instance is in read-only mode. Read at call time. */
export function isReadonly(): boolean {
  return process.env.IS_READONLY === "true";
}

/**
 * API paths that MUST stay writable even in read-only mode.
 *
 * - `/api/auth/**`   — NextAuth sign-in is POST; login must work during the
 *                       grace period
 * - `/api/health`    — health probe; GET-only anyway but explicit
 *
 * Exported as an array so it can be unit-tested. Paths are compared via
 * `startsWith`, so include the trailing context as needed.
 */
export const READONLY_ALLOWLIST: ReadonlyArray<string> = [
  "/api/auth/",
  "/api/health",
];

export function isAllowlistedForWrite(pathname: string): boolean {
  return READONLY_ALLOWLIST.some((p) => pathname.startsWith(p));
}

/**
 * Throws when the instance is read-only. Call at the top of every mutating
 * server action (server actions don't go through middleware).
 */
export function assertWritable(): void {
  if (isReadonly()) {
    throw new Error("read_only");
  }
}

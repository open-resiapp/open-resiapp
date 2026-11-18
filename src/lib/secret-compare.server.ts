import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a provided shared secret (cron secret, bearer
 * token …) against the expected one. Both sides are SHA-256 hashed first so
 * the comparison runs over equal-length buffers and leaks neither content
 * nor length through timing. A missing / empty provided value never matches.
 */
export function secretsEqual(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

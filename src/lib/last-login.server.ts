import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * BYT-20261118-003: stamp users.last_login_at on a successful sign-in
 * (credentials / passkey via Auth.js events.signIn, and the cloud SSO
 * route). A single-row UPDATE — no lock beyond the row, no loop, safe on
 * every replica. Never throws: a failed write must not block the login.
 * Kiosk / on-site PIN sessions (if they ever exist) must NOT call this.
 */
export async function recordLastLogin(userId: string): Promise<void> {
  try {
    await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, userId));
  } catch (err) {
    console.error("[auth] last_login_at update failed:", err);
  }
}

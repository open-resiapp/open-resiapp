import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordLastLogin } from "@/lib/last-login.server";
import type { UserRole, UserStatus } from "@/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      status: UserStatus;
    };
  }

  interface User {
    role: UserRole;
    status: UserStatus;
  }
}

// Augment next-auth/jwt (the direct-dep subpath), not the transitive
// @auth/core/jwt — the latter isn't resolvable under pnpm's strict layout.
declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    status: UserStatus;
    /** epoch ms of the last DB re-validation of this account */
    checkedAt?: number;
  }
}

/** How long a JWT may go without re-reading the user row. */
const SESSION_RECHECK_MS = 60_000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "Prihlásenie",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Heslo", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, email), isNotNull(users.email)))
          .limit(1);

        if (!user || !user.isActive || user.status === "rejected") {
          return null;
        }

        // Shell users (imported from a Kataster LV before pairing) have
        // no password hash and cannot sign in via credentials.
        if (!user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        // user.email is non-null here: the credentials provider only matches
        // users whose email equals the input, so the column is guaranteed
        // non-null at this point.
        return {
          id: user.id,
          email: user.email!,
          name: user.name,
          role: user.role,
          status: user.status,
        };
      },
    }),
    // Sign-in with an activated passkey (BYT-20261117-002 follow-up). The
    // browser sends the WebAuthn assertion as JSON; verifyPasskeyLogin checks
    // the signed challenge, signature, counter and single use.
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { response: { label: "Passkey", type: "text" } },
      async authorize(credentials, request) {
        const raw = credentials?.response;
        if (typeof raw !== "string" || raw.length > 20_000) return null;
        let response: unknown;
        try {
          response = JSON.parse(raw);
        } catch {
          return null;
        }
        const { verifyPasskeyLogin } = await import("@/lib/webauthn.server");
        let result;
        try {
          result = await verifyPasskeyLogin(
            request,
            response as Parameters<typeof verifyPasskeyLogin>[1]
          );
        } catch (err) {
          console.error("[auth] passkey sign-in failed", err);
          return null;
        }
        if (!result.ok) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, result.userId))
          .limit(1);
        if (!user || !user.isActive || user.status === "rejected") return null;
        return {
          id: user.id,
          email: user.email ?? "",
          name: user.name,
          role: user.role,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.status = user.status;
        // Fresh sign-in: authorize() just read the row.
        token.checkedAt = Date.now();
        return token;
      }
      if (!token.id) return token;
      // Re-validate the account against the DB at most every
      // SESSION_RECHECK_MS (and always on update() / while pending), so a
      // deactivated, rejected, merged or anonymised user loses access within
      // a minute instead of at JWT expiry. One PK lookup.
      const stale =
        typeof token.checkedAt !== "number" ||
        Date.now() - token.checkedAt > SESSION_RECHECK_MS;
      if (trigger === "update" || token.status === "pending" || stale) {
        const [fresh] = await db
          .select({
            role: users.role,
            status: users.status,
            isActive: users.isActive,
            mergedIntoUserId: users.mergedIntoUserId,
            anonymizedAt: users.anonymizedAt,
          })
          .from(users)
          .where(eq(users.id, token.id))
          .limit(1);
        if (
          !fresh ||
          !fresh.isActive ||
          fresh.status === "rejected" ||
          fresh.mergedIntoUserId !== null ||
          fresh.anonymizedAt !== null
        ) {
          // Returning null makes @auth/core clear the session cookie and
          // auth() resolve to null -> protected pages redirect to /login.
          return null;
        }
        token.role = fresh.role;
        token.status = fresh.status;
        token.checkedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.status = token.status;
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user?.id) return;
      // BYT-20261118-003: last sign-in for the board's owner queue. One-row
      // UPDATE, never blocks the login (failure is only logged).
      await recordLastLogin(user.id);
      if (!user.email) return;
      const { dispatchHook } = await import("@/lib/modules/dispatch");
      await dispatchHook("onUserLogin", {
        id: user.id,
        email: user.email,
        loggedInAt: new Date(),
      }).catch((err) => console.error("[modules] onUserLogin failed:", err));
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});

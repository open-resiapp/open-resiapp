import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
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

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    status: UserStatus;
  }
}

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
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.isActive || user.status === "rejected") {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
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
      }
      const shouldRefresh =
        token.id && (trigger === "update" || token.status === "pending");
      if (shouldRefresh) {
        const [fresh] = await db
          .select({ role: users.role, status: users.status })
          .from(users)
          .where(eq(users.id, token.id))
          .limit(1);
        if (fresh) {
          token.role = fresh.role;
          token.status = fresh.status;
        }
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
      if (!user?.id || !user.email) return;
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

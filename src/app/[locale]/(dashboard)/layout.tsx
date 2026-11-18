import { headers } from "next/headers";
import { SessionProvider } from "next-auth/react";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { getShellData } from "@/lib/shell.server";
import { ShellProvider } from "@/components/layout/ShellContext";
import AppShell from "@/components/layout/AppShell";
import PendingShell from "@/components/layout/PendingShell";
import ConsentGate from "@/components/consent/ConsentGate";

// BYT-20261117-002 Phase 1: server shell. Session, community, branding,
// enabled modules, entity scope, consent, onboarding, share-sum state,
// board roles and owned units are resolved ONCE here (src/lib/shell.server.ts)
// and provided via <ShellProvider>. The chrome renders with real data on
// the first paint; no client fetches on mount.
//
// Dynamic by nature (auth() reads cookies). RSC navigation between pages
// reuses this layout without re-rendering it; `router.refresh()` after a
// shell-relevant mutation re-resolves it.

/** Request header with the original path + query, set by src/proxy.ts. */
const PATH_HEADER = "x-resiapp-path";

/**
 * Where to return after login: the requested in-app path (with query) when
 * it is a safe same-origin relative path — never protocol-relative, never a
 * backslash trick, never the auth pages themselves.
 */
function safeCallbackPath(raw: string | null, locale: string): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith(`/${locale}/`) && raw !== `/${locale}`) return null;
  if (raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  if (/^\/[^/]+\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session] = await Promise.all([params, auth()]);

  if (!session?.user?.id) {
    // Keep the target (e.g. an AI confirm link or an e-mailed vote link) so
    // login lands back on it instead of the home page.
    const back = safeCallbackPath((await headers()).get(PATH_HEADER), locale);
    redirect({
      href: back ? { pathname: "/login", query: { callbackUrl: back } } : "/login",
      locale,
    });
    // `redirect` throws; the return keeps TypeScript's narrowing honest.
    return null;
  }

  const shell = await getShellData(session);

  let body: React.ReactNode;
  if (shell.user.status === "pending") {
    body = <PendingShell>{children}</PendingShell>;
  } else if (shell.consent.needsConsent) {
    // Full-screen consent step instead of the chrome — no flash of the app.
    body = <ConsentGate />;
  } else {
    body = <AppShell>{children}</AppShell>;
  }

  // Nested SessionProvider seeded with the server session: existing pages
  // that call useSession() get `authenticated` on their first render (the
  // old client layout withheld children until the session loaded, and
  // several pages still assume that). Window-focus refetch stays with the
  // root provider to avoid doubling /api/auth/session traffic.
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <ShellProvider data={shell}>{body}</ShellProvider>
    </SessionProvider>
  );
}

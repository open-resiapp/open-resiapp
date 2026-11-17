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

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session] = await Promise.all([params, auth()]);

  if (!session?.user?.id) {
    redirect({ href: "/login", locale });
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

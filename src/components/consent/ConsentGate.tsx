"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";
import { Icon } from "@/components/ui";
import ConsentForm from "./ConsentForm";

/**
 * Full-screen GDPR consent step (BYT-20261117-002 Phase 1).
 *
 * The dashboard server layout decides whether consent is missing
 * (ShellData.consent, same rule as GET /api/consents) and renders this
 * INSTEAD of the app chrome — no sidebar, no nav, only logout — so there
 * is no flash of the app and no client round trip before the decision.
 *
 * Legal content and submit behaviour are unchanged: ConsentForm POSTs the
 * same records to /api/consents. On success we `router.refresh()` so the
 * server layout re-resolves and swaps in the normal shell.
 */
export default function ConsentGate() {
  const t = useTranslations("Header");
  const tSidebar = useTranslations("Sidebar");
  const { consent, community, user } = useShell();
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-gray-200 dark:bg-gray-900 dark:border-gray-800">
        <div className="min-w-0">
          <div className="text-base font-semibold text-gray-900 truncate dark:text-gray-100">
            {community?.name || tSidebar("appName")}
          </div>
          {user.name ? (
            <div className="text-sm text-gray-600 truncate dark:text-gray-300">{user.name}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-base font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Icon name="logout" size={20} />
          {t("logout")}
        </button>
      </header>
      <main className="flex-1 px-4 py-6 sm:py-10">
        <ConsentForm
          policyVersion={consent.policyVersion}
          onSuccess={() => startTransition(() => router.refresh())}
        />
      </main>
    </div>
  );
}

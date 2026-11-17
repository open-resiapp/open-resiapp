"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import Header from "@/components/layout/Header";

export const PENDING_ALLOWED_PATH = "/community-info";

/**
 * Minimal chrome for a user whose registration is still pending: no nav,
 * no consent gate (unchanged from before), only /community-info is
 * reachable. The server layout cannot see the pathname, so the redirect
 * happens here — but other pages' content is never rendered meanwhile.
 */
export default function PendingShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Common");
  const pathname = usePathname();
  const router = useRouter();
  const allowed = pathname === PENDING_ALLOWED_PATH;

  useEffect(() => {
    if (!allowed) router.replace(PENDING_ALLOWED_PATH);
  }, [allowed, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col dark:bg-gray-950">
      <Header showProfileLink={false} />
      <main className="flex-1 p-4 lg:p-6">
        {allowed ? (
          children
        ) : (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg text-gray-600 dark:text-gray-300">{t("loading")}</div>
          </div>
        )}
      </main>
    </div>
  );
}

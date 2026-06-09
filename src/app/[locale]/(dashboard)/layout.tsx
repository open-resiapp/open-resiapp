"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import InstallPrompt from "@/components/InstallPrompt";
import ConsentGate from "@/components/consent/ConsentGate";
import ShareSumInvariantBanner from "@/components/admin/ShareSumInvariantBanner";
import OnboardingBanner from "@/components/onboarding/OnboardingBanner";
import type { UserRole } from "@/types";

const PENDING_ALLOWED_PATH = "/community-info";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Common");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (
      status === "authenticated" &&
      session?.user.status === "pending" &&
      pathname !== PENDING_ALLOWED_PATH
    ) {
      router.replace(PENDING_ALLOWED_PATH);
    }
  }, [status, session?.user.status, pathname, router]);

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-lg text-gray-500 dark:text-gray-400">{t("loading")}</div>
      </div>
    );
  }

  const isPending = session.user.status === "pending";

  return (
    <div className="min-h-screen bg-gray-50 flex dark:bg-gray-950">
      <ServiceWorkerRegistration />
      <InstallPrompt />
      {!isPending && (
        <Sidebar
          role={session.user.role as UserRole}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          userName={session.user.name || ""}
          onMenuToggle={isPending ? undefined : () => setSidebarOpen(!sidebarOpen)}
          showMenu={!isPending}
          showProfileLink={!isPending}
        />
        <main className="flex-1 p-4 lg:p-6">
          {!isPending && <OnboardingBanner />}
          {!isPending && <ShareSumInvariantBanner />}
          {isPending ? children : <ConsentGate>{children}</ConsentGate>}
        </main>
      </div>
    </div>
  );
}

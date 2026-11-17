"use client";

import { useState } from "react";

import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import BottomTabBar from "@/components/layout/BottomTabBar";
import { useShell } from "@/components/layout/ShellContext";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import InstallPrompt from "@/components/InstallPrompt";
import ShareSumInvariantBanner from "@/components/admin/ShareSumInvariantBanner";
import OnboardingBanner from "@/components/onboarding/OnboardingBanner";
import { ConfirmProvider } from "@/components/ui";

/**
 * Chrome for an active user who has given consent. Rendered by the server
 * layout with ShellData already in context, so the nav paints on the first
 * frame (no fetch, no flash). BYT-20261117-002 Phase 1/3.
 *
 * Owner audience: desktop sidebar + mobile bottom tab bar (no hamburger).
 * Board audience: desktop sidebar + mobile drawer behind a "Menu" button.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { audience } = useShell();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isOwner = audience === "owner";

  return (
    <div
      className={`min-h-screen bg-gray-50 flex dark:bg-gray-950 ${
        // Height the bottom tab bar occupies on mobile; read by the main
        // padding below and by InstallPrompt so neither hides behind it.
        isOwner ? "max-lg:[--shell-bottom-offset:calc(4rem_+_env(safe-area-inset-bottom))]" : ""
      }`}
    >
      <ServiceWorkerRegistration />
      <InstallPrompt />
      <Sidebar isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onMenuToggle={isOwner ? undefined : () => setDrawerOpen((o) => !o)}
          menuOpen={drawerOpen}
        />
        <main
          className={`flex-1 p-4 lg:p-6 ${
            isOwner ? "max-lg:pb-[calc(var(--shell-bottom-offset)_+_1rem)]" : ""
          }`}
        >
          <OnboardingBanner />
          <ShareSumInvariantBanner />
          {/* One provider for every page: useConfirm() replaces window.confirm. */}
          <ConfirmProvider>{children}</ConfirmProvider>
        </main>
      </div>
      {isOwner && <BottomTabBar />}
    </div>
  );
}

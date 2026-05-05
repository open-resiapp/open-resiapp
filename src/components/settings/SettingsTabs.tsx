"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export type SettingsTab = "building" | "entrances" | "flats" | "voting" | "boardMembers" | "connections";

interface SettingsTabsProps {
  activeTab: SettingsTab | null;
  onTabChange: (tab: SettingsTab) => void;
  alertCount?: number;
  // Tabs that navigate (link-style) rather than switch local state.
  // Hidden when the corresponding flag is false.
  showModules?: boolean;
  showRegistrationQr?: boolean;
}

const tabs: SettingsTab[] = ["building", "entrances", "flats", "voting", "boardMembers", "connections"];

export default function SettingsTabs({
  activeTab,
  onTabChange,
  alertCount,
  showModules = false,
  showRegistrationQr = false,
}: SettingsTabsProps) {
  const t = useTranslations("Settings");

  const tabLabels: Record<SettingsTab, string> = {
    building: t("tabBuilding"),
    entrances: t("tabEntrances"),
    flats: t("tabFlats"),
    voting: t("tabVoting"),
    boardMembers: t("tabBoardMembers"),
    connections: t("tabConnections"),
  };

  const baseClass =
    "whitespace-nowrap py-3 px-1 border-b-2 text-base font-medium transition-colors relative";
  const activeClass = "border-blue-600 text-blue-600";
  const inactiveClass =
    "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300";

  const pathname = usePathname();
  const onModulesPage = pathname?.startsWith("/settings/modules") ?? false;
  const onRegistrationQrPage =
    pathname?.startsWith("/settings/registration-qr") ?? false;
  // Base tabs switch local state when we're on the root /settings page;
  // on sub-pages they navigate back via ?tab=... so the user gets the
  // expected jump rather than a no-op click.
  const onSettingsRoot = pathname === "/settings";

  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = onSettingsRoot && activeTab === tab;
          const className = `${baseClass} ${
            isActive ? activeClass : inactiveClass
          }`;
          const badge =
            tab === "connections" && alertCount && alertCount > 0 ? (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            ) : null;
          if (onSettingsRoot) {
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={className}
              >
                {tabLabels[tab]}
                {badge}
              </button>
            );
          }
          return (
            <Link
              key={tab}
              href={{ pathname: "/settings", query: { tab } }}
              className={className}
            >
              {tabLabels[tab]}
              {badge}
            </Link>
          );
        })}
        {showRegistrationQr && (
          <Link
            href="/settings/registration-qr"
            className={`${baseClass} ${
              onRegistrationQrPage ? activeClass : inactiveClass
            }`}
          >
            {t("registrationQrLink")}
          </Link>
        )}
        {showModules && (
          <Link
            href="/settings/modules"
            className={`${baseClass} ${onModulesPage ? activeClass : inactiveClass}`}
          >
            Modules
          </Link>
        )}
      </nav>
    </div>
  );
}

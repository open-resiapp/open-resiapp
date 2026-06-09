"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useCommunityKinds } from "@/hooks/useCommunityKinds";

export type SettingsTab = "building" | "branding" | "entrances" | "flats" | "voting" | "boardMembers" | "connections";

interface SettingsTabsProps {
  activeTab: SettingsTab | null;
  onTabChange: (tab: SettingsTab) => void;
  alertCount?: number;
  // Tabs that navigate (link-style) rather than switch local state.
  // Hidden when the corresponding flag is false.
  showModules?: boolean;
  showRegistrationQr?: boolean;
  // RES-20260609-001: Import + the onboarding guide moved out of the
  // top-level nav and live here as link-style tabs.
  showImport?: boolean;
  // BYT-20260512-008: white-label logo tab — admin (manageSettings) only.
  showBranding?: boolean;
}

const baseTabs: SettingsTab[] = ["building", "entrances", "flats", "voting", "boardMembers", "connections"];

export default function SettingsTabs({
  activeTab,
  onTabChange,
  alertCount,
  showModules = false,
  showRegistrationQr = false,
  showImport = false,
  showBranding = false,
}: SettingsTabsProps) {
  const t = useTranslations("Settings");
  const tRoot = useTranslations();

  // BYT-20260515-001 Phase 7b: tab labels reflect the install
  // template's kind chain so non-HOA tenants don't see "Vchody" /
  // "Byty" against a garden or garage tree. Falls back to the legacy
  // HOA-shaped keys (`tabBuilding`, `tabEntrances`, `tabFlats`) when
  // the chain isn't loaded yet or the instance predates Phase 5.
  const { templateSlug, middleKind, leafKind } = useCommunityKinds();
  const rootTabLabel = templateSlug
    ? tRoot(`Templates.${templateSlug}.name`)
    : t("tabBuilding");
  const middleTabLabel = middleKind ? tRoot(`Kinds.${middleKind}`) : t("tabEntrances");
  const leafTabLabel = leafKind ? tRoot(`Kinds.${leafKind}`) : t("tabFlats");

  const tabLabels: Record<SettingsTab, string> = {
    building: rootTabLabel,
    branding: t("tabBranding"),
    entrances: middleTabLabel,
    flats: leafTabLabel,
    voting: t("tabVoting"),
    boardMembers: t("tabBoardMembers"),
    connections: t("tabConnections"),
  };

  // Branding sits next to "building" but only for admins (manageSettings).
  const tabs: SettingsTab[] = showBranding
    ? ["building", "branding", "entrances", "flats", "voting", "boardMembers", "connections"]
    : baseTabs;

  const baseClass =
    "whitespace-nowrap py-3 px-1 border-b-2 text-base font-medium transition-colors relative";
  const activeClass = "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400";
  const inactiveClass =
    "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600";

  const pathname = usePathname();
  const onModulesPage = pathname?.startsWith("/settings/modules") ?? false;
  const onRegistrationQrPage =
    pathname?.startsWith("/settings/registration-qr") ?? false;
  const onImportPage = pathname?.startsWith("/admin/import") ?? false;
  // Base tabs switch local state when we're on the root /settings page;
  // on sub-pages they navigate back via ?tab=... so the user gets the
  // expected jump rather than a no-op click.
  const onSettingsRoot = pathname === "/settings";

  return (
    <div className="border-b border-gray-200 mb-6 dark:border-gray-700">
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
        {showImport && (
          <Link
            href="/admin/import"
            className={`${baseClass} ${onImportPage ? activeClass : inactiveClass}`}
          >
            {t("importLink")}
          </Link>
        )}
        {showImport && (
          <Link href="/onboarding" className={`${baseClass} ${inactiveClass}`}>
            {t("setupGuideLink")}
          </Link>
        )}
      </nav>
    </div>
  );
}

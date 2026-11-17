"use client";

import { useTranslations } from "next-intl";
import { Tabs } from "@/components/ui";

export type SettingsTab = "community" | "building" | "board" | "voting";

export const SETTINGS_TABS: ReadonlyArray<SettingsTab> = ["community", "building", "board", "voting"];

interface SettingsTabsProps {
  /** Active tab on /settings; null on sub-pages (no tab highlighted). */
  activeTab?: SettingsTab | null;
  /** Deprecated: tabs are links (`?tab=`), nothing to handle. */
  onTabChange?: (tab: SettingsTab) => void;
  // Deprecated props kept so older callers still compile; the "Viac" dropdown
  // is gone (Pokročilé lives at /settings/advanced).
  alertCount?: number;
  showModules?: boolean;
  showRegistrationQr?: boolean;
  showImport?: boolean;
  showBranding?: boolean;
}

/** Kit Tabs rendered as links to /settings?tab=… — usable on /settings and sub-pages. */
export default function SettingsTabs({ activeTab = null }: SettingsTabsProps) {
  const t = useTranslations("SettingsHub");
  const labels: Record<SettingsTab, string> = {
    community: t("tabCommunity"),
    building: t("tabBuilding"),
    board: t("tabBoard"),
    voting: t("tabVoting"),
  };
  return (
    <Tabs
      aria-label={t("tabsLabel")}
      value={activeTab ?? ""}
      items={SETTINGS_TABS.map((tab) => ({
        value: tab,
        label: labels[tab],
        href: { pathname: "/settings", query: { tab } },
      }))}
    />
  );
}

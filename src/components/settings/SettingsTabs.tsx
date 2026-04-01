"use client";

import { useTranslations } from "next-intl";

export type SettingsTab = "building" | "entrances" | "flats" | "voting" | "connections";

interface SettingsTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  alertCount?: number;
}

const tabs: SettingsTab[] = ["building", "entrances", "flats", "voting", "connections"];

export default function SettingsTabs({ activeTab, onTabChange, alertCount }: SettingsTabsProps) {
  const t = useTranslations("Settings");

  const tabLabels: Record<SettingsTab, string> = {
    building: t("tabBuilding"),
    entrances: t("tabEntrances"),
    flats: t("tabFlats"),
    voting: t("tabVoting"),
    connections: t("tabConnections"),
  };

  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`whitespace-nowrap py-3 px-1 border-b-2 text-base font-medium transition-colors relative ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tabLabels[tab]}
            {tab === "connections" && alertCount && alertCount > 0 ? (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

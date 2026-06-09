"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import SettingsTabs, { type SettingsTab } from "@/components/settings/SettingsTabs";
import StructureTab from "@/components/settings/StructureTab";
import BrandingTab from "@/components/settings/BrandingTab";
import VotingSettingsTab from "@/components/settings/VotingSettingsTab";
import ExternalConnectionsTab from "@/components/settings/ExternalConnectionsTab";
import BoardMembersTab from "@/components/settings/BoardMembersTab";

const VALID_TABS: ReadonlyArray<SettingsTab> = [
  "structure",
  "branding",
  "voting",
  "boardMembers",
  "connections",
];

// RES-20260609-002: building/entrances/flats merged into "structure".
// Map the old tab values so existing bookmarks and the onboarding link
// still land on the right tab.
const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
  building: "structure",
  entrances: "structure",
  flats: "structure",
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const t = useTranslations("Settings");
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const resolvedTab = rawTab ? (LEGACY_TAB_ALIASES[rawTab] ?? rawTab) : null;
  const initialTab =
    (VALID_TABS.find((x) => x === resolvedTab) as SettingsTab) ?? "structure";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [alertCount, setAlertCount] = useState(0);

  const role = (session?.user?.role || "owner") as UserRole;
  const canEdit = hasPermission(role, "manageSettings");

  useEffect(() => {
    if (!canEdit) return;
    fetch("/api/external-connections/alerts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setAlertCount(data.totalAlerts);
      })
      .catch(() => {});
  }, [canEdit]);

  if (!hasPermission(role, "viewSettings")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        {t("noPermission")}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
      </div>

      <SettingsTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        alertCount={alertCount}
        showModules={hasPermission(role, "manageSettings")}
        showRegistrationQr={hasPermission(role, "manageUsers")}
        showImport={hasPermission(role, "manageSettings")}
        showBranding={hasPermission(role, "manageSettings")}
      />

      {activeTab === "structure" && <StructureTab canEdit={canEdit} />}
      {activeTab === "branding" && canEdit && <BrandingTab canEdit={canEdit} />}
      {activeTab === "voting" && <VotingSettingsTab canEdit={canEdit} />}
      {activeTab === "boardMembers" && <BoardMembersTab canEdit={canEdit} />}
      {activeTab === "connections" && canEdit && <ExternalConnectionsTab />}
    </div>
  );
}

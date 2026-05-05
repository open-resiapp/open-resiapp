"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import SettingsTabs, { type SettingsTab } from "@/components/settings/SettingsTabs";
import BuildingInfoTab from "@/components/settings/BuildingInfoTab";
import EntrancesTab from "@/components/settings/EntrancesTab";
import FlatsTab from "@/components/settings/FlatsTab";
import VotingSettingsTab from "@/components/settings/VotingSettingsTab";
import ExternalConnectionsTab from "@/components/settings/ExternalConnectionsTab";
import BoardMembersTab from "@/components/settings/BoardMembersTab";

export default function SettingsPage() {
  const { data: session } = useSession();
  const t = useTranslations("Settings");
  const [activeTab, setActiveTab] = useState<SettingsTab>("building");
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
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        {hasPermission(role, "manageUsers") && (
          <Link
            href="/settings/registration-qr"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            {t("registrationQrLink")}
          </Link>
        )}
      </div>

      <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} alertCount={alertCount} />

      {activeTab === "building" && <BuildingInfoTab canEdit={canEdit} />}
      {activeTab === "entrances" && <EntrancesTab canEdit={canEdit} />}
      {activeTab === "flats" && <FlatsTab canEdit={canEdit} />}
      {activeTab === "voting" && <VotingSettingsTab canEdit={canEdit} />}
      {activeTab === "boardMembers" && <BoardMembersTab canEdit={canEdit} />}
      {activeTab === "connections" && canEdit && <ExternalConnectionsTab />}
    </div>
  );
}

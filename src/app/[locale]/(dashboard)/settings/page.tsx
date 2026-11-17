import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { UserRole } from "@/types";
import { Icon, PageHeader } from "@/components/ui";
import SettingsTabs, { type SettingsTab } from "@/components/settings/SettingsTabs";
import CommunityTab from "@/components/settings/CommunityTab";
import StructureTab from "@/components/settings/StructureTab";
import BoardMembersTab from "@/components/settings/BoardMembersTab";
import VotingSettingsTab from "@/components/settings/VotingSettingsTab";

// Old `?tab=` values keep working. Phase 5 layout: Spoločenstvo (incl. logo) ·
// Budova a byty · Orgány správy · Hlasovanie. `connections` moved to
// /settings/advanced/connections (redirect below).
const TAB_ALIASES: Record<string, SettingsTab> = {
  community: "community",
  structure: "community",
  branding: "community",
  building: "building",
  entrances: "building",
  flats: "building",
  boardMembers: "board",
  board: "board",
  voting: "voting",
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ locale }, sp, session, t] = await Promise.all([
    params,
    searchParams,
    auth(),
    getTranslations("Settings"),
  ]);
  const th = await getTranslations("SettingsHub");

  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  if (rawTab === "connections") {
    redirect({ href: "/settings/advanced/connections", locale });
    return null;
  }

  const role = (session?.user?.role || "owner") as UserRole;
  if (!hasPermission(role, "viewSettings")) {
    return <div className="py-12 text-center text-lg text-ui-text-muted">{t("noPermission")}</div>;
  }
  const canEdit = hasPermission(role, "manageSettings");
  const tab: SettingsTab = (rawTab && TAB_ALIASES[rawTab]) || "community";

  // The community root feeds the community + voting tabs; resolve it here
  // instead of a client fetch on mount.
  let building = null;
  if (tab === "community" || tab === "voting") {
    const root = await getCommunityRoot();
    building = root
      ? {
          id: root.id,
          name: root.name,
          address: root.address,
          ico: root.ico,
          votingMethod: root.votingMethod as string,
          country: root.country as string,
          governanceModel: root.governanceModel as string,
          legalNotice: root.legalNotice,
        }
      : null;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} className="mb-4" />
      <SettingsTabs activeTab={tab} />

      <div className="mt-6">
        {tab === "community" && <CommunityTab canEdit={canEdit} initial={building} />}
        {tab === "building" && <StructureTab canEdit={canEdit} />}
        {tab === "board" && <BoardMembersTab canEdit={canEdit} />}
        {tab === "voting" && (
          <VotingSettingsTab
            canEdit={canEdit}
            initialMethod={building?.votingMethod ?? "per_share"}
            initialLegalNotice={building?.legalNotice ?? null}
          />
        )}
      </div>

      {canEdit ? (
        <p className="mt-10 border-t border-ui-border pt-4">
          <Link
            href="/settings/advanced"
            className="inline-flex min-h-11 items-center gap-1 text-base text-ui-text-muted underline underline-offset-4 hover:text-ui-text"
          >
            {th("advancedLink")}
            <Icon name="chevronRight" size={18} />
          </Link>
        </p>
      ) : null}
    </div>
  );
}

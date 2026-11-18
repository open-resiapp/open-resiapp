import { getTranslations } from "next-intl/server";

import { Tabs } from "@/components/ui";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import type { BoardMemberRole, UserRole } from "@/types";

import { boardAccessFor } from "../lib/authz.server";
import { countBoardFaults } from "../lib/queries.server";

// Board "Oznamy · Poruchy" tab bar (BYT-20261118-004 IA): shown on /board
// and /poruchy for users with fault board access when the module is on.
// Plain links — no client state. `newCount` = faults in status `new`.

export async function NoticesFaultsTabs({
  active,
  newCount,
}: {
  active: "notices" | "faults";
  newCount: number;
}) {
  const t = await getTranslations("Faults");
  return (
    <Tabs
      className="mb-6"
      aria-label={t("tabs.label")}
      value={active}
      items={[
        { value: "notices", label: t("tabs.notices"), href: "/board" },
        {
          value: "faults",
          label: t("tabs.faults"),
          href: "/poruchy",
          badge: newCount > 0 ? t("tabs.newBadge", { count: newCount }) : undefined,
        },
      ]}
    />
  );
}

/**
 * Self-gating slot for /board: renders the tabs only when the faults module
 * is enabled and the viewer has fault board access.
 */
export async function NoticesFaultsTabsSlot({
  role,
  boardRoles,
}: {
  role: UserRole;
  boardRoles: readonly BoardMemberRole[];
}) {
  if (!boardAccessFor(role, boardRoles)) return null;
  if (!(await isModuleEnabled("faults"))) return null;
  const root = await getCommunityRoot();
  if (!root) return null;
  const counts = await countBoardFaults(root.id).catch(() => ({ new: 0, stale: 0 }));
  return <NoticesFaultsTabs active="notices" newCount={counts.new} />;
}

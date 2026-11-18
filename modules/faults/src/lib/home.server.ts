import "server-only";

import { getTranslations } from "next-intl/server";

import type { Viewer } from "@/lib/home.server";

import { boardAccessFor } from "./authz.server";
import { countBoardFaults, countMyOpenFaults } from "./queries.server";
import { hasPermission } from "@/lib/permissions";

// Domov integration (BYT-20261118-004 IA). Read-only, per request.

export interface FaultTodoRow {
  key: string;
  href: string;
  icon: "alert" | "clock";
  label: string;
  tone?: "warning" | "danger";
}

/** Board "Čo treba teraz": N new faults, N faults open > 30 days. */
export async function loadFaultTodoRows(viewer: Viewer): Promise<FaultTodoRow[]> {
  if (!viewer.root || !viewer.enabledModules.has("faults")) return [];
  if (!boardAccessFor(viewer.role, viewer.boardRoles)) return [];
  const [counts, t] = await Promise.all([countBoardFaults(viewer.root.id), getTranslations("Faults")]);
  const rows: FaultTodoRow[] = [];
  if (counts.new > 0) {
    rows.push({
      key: "faults-new",
      href: "/poruchy?stav=new",
      icon: "alert",
      tone: "warning",
      label: t("home.boardNew", { count: counts.new }),
    });
  }
  if (counts.stale > 0) {
    rows.push({
      key: "faults-stale",
      href: "/poruchy?stare=1",
      icon: "clock",
      tone: "danger",
      label: t("home.boardStale", { count: counts.stale }),
    });
  }
  return rows;
}

/** Owner Domov card data; null = hide the card. */
export async function loadOwnerFaultCard(
  viewer: Viewer
): Promise<{ canReport: boolean; openNew: number; openInProgress: number } | null> {
  if (!viewer.root || !viewer.enabledModules.has("faults")) return null;
  const canReport = hasPermission(viewer.role, "reportFault");
  const mine = await countMyOpenFaults(viewer.userId, viewer.root.id);
  if (!canReport && mine.new + mine.inProgress === 0) return null;
  return { canReport, openNew: mine.new, openInProgress: mine.inProgress };
}

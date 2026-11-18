import { getTranslations } from "next-intl/server";

import { cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";

import { daysOpen } from "../engine/transitions";
import type { FaultBoardListItem } from "../lib/queries.server";
import { FaultPriorityBadge, FaultStatusBadge } from "./badges";

// Board list (BYT-20261118-004): table ≥ 768 px, stacked cards < 768 px
// (no horizontal scroll at 390 px). Server component.

export async function BoardFaultList({
  faults,
  categoryLabel,
}: {
  faults: FaultBoardListItem[];
  categoryLabel: Record<string, string>;
}) {
  const t = await getTranslations("Faults");
  const now = new Date();
  const who = (f: FaultBoardListItem) => f.assigneeName ?? f.contractorName ?? t("list.unassigned");
  const age = (f: FaultBoardListItem) => t("list.openDays", { days: daysOpen(new Date(f.createdAt), now) });

  return (
    <>
      <ul className="space-y-2 md:hidden">
        {faults.map((f) => (
          <li key={f.id}>
            <Link
              href={`/poruchy/${f.id}`}
              className={cn(
                "block space-y-2 rounded-xl border border-ui-border bg-ui-surface px-4 py-3 text-ui-text hover:bg-ui-surface-muted",
                focusRing
              )}
            >
              <span className="block text-base font-medium break-words">{f.title}</span>
              <span className="flex flex-wrap gap-2">
                <FaultStatusBadge status={f.status} label={t(`status.${f.status}`)} />
                <FaultPriorityBadge priority={f.priority} label={t(`priority.${f.priority}`)} />
              </span>
              <span className="block text-base text-ui-text-muted break-words">
                {f.locationLabel} · {age(f)}
              </span>
              <span className="block text-base text-ui-text-muted break-words">
                {t("list.assigneeLine", { name: who(f) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <table className="hidden w-full border-collapse text-left text-base md:table">
        <thead>
          <tr className="border-b border-ui-border text-ui-text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">{t("list.colTitle")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("list.colStatus")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("list.colPriority")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("list.colCategory")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("list.colAssignee")}</th>
            <th scope="col" className="py-2 font-medium">{t("list.colAge")}</th>
          </tr>
        </thead>
        <tbody>
          {faults.map((f) => (
            <tr key={f.id} className="border-b border-ui-border align-top">
              <td className="py-3 pr-3">
                <Link href={`/poruchy/${f.id}`} className={cn("font-medium underline-offset-4 hover:underline", focusRing)}>
                  {f.title}
                </Link>
                <span className="block text-ui-text-muted">{f.locationLabel}</span>
              </td>
              <td className="py-3 pr-3">
                <FaultStatusBadge status={f.status} label={t(`status.${f.status}`)} />
              </td>
              <td className="py-3 pr-3">
                <FaultPriorityBadge priority={f.priority} label={t(`priority.${f.priority}`)} />
              </td>
              <td className="py-3 pr-3">{f.categoryId ? (categoryLabel[f.categoryId] ?? "—") : "—"}</td>
              <td className="py-3 pr-3">{who(f)}</td>
              <td className="py-3">{age(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

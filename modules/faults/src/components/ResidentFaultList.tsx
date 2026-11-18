import { getFormatter, getTranslations } from "next-intl/server";

import { Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";

import type { FaultResidentView } from "../engine/views";
import { FaultStatusBadge } from "./badges";

// Resident list: "Moje hlásenia" and "Hlásenia v dome". Server component.

export async function ResidentFaultList({
  faults,
  showLatestMessage,
}: {
  faults: FaultResidentView[];
  showLatestMessage: boolean;
}) {
  const [t, format] = await Promise.all([getTranslations("Faults"), getFormatter()]);
  return (
    <ul className="space-y-2">
      {faults.map((f) => {
        const latest = [...f.publicEvents].reverse().find((e) => e.message);
        return (
          <li key={f.id}>
            <Link
              href={`/poruchy/${f.id}`}
              className={cn(
                "flex min-h-14 items-start gap-3 rounded-xl border border-ui-border bg-ui-surface px-4 py-3 text-ui-text hover:border-ui-border-strong hover:bg-ui-surface-muted",
                focusRing
              )}
            >
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium break-words">{f.title}</span>
                  <FaultStatusBadge status={f.status} label={t(`status.${f.status}`)} />
                </span>
                <span className="block text-base text-ui-text-muted">
                  {f.locationLabel} · {format.dateTime(new Date(f.createdAt), { dateStyle: "medium" })}
                </span>
                {showLatestMessage && latest?.message ? (
                  <span className="block text-base break-words text-ui-text">
                    {t("list.latestMessage", { message: latest.message })}
                  </span>
                ) : null}
              </span>
              <Icon name="chevronRight" size={20} className="mt-1 shrink-0 text-ui-text-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

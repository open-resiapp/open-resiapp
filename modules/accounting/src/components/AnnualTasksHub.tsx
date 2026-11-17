"use client";

// "Ročné úlohy" hub (BYT-20261117-002 Phase 5) on top of /accounting/predpis.
// The yearly jobs in the order they happen. Links only — the logic stays on
// its own page (the závierka approval lives on the journal page).

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge, Card, Icon, type BadgeTone, type IconName } from "@/components/ui";

export interface AnnualTaskStatus {
  label: string;
  tone: BadgeTone;
}

export default function AnnualTasksHub({ predpisStatus }: { predpisStatus?: AnnualTaskStatus }) {
  const t = useTranslations("Accounting.annual");

  const tasks: {
    key: string;
    href: string;
    icon: IconName;
    status?: AnnualTaskStatus;
  }[] = [
    { key: "predpis", href: "/accounting/predpis#mesacne-platby", icon: "calendar", status: predpisStatus },
    { key: "meters", href: "/accounting/meters", icon: "edit" },
    { key: "settlement", href: "/accounting/vyuctovanie", icon: "file" },
    { key: "zavierka", href: "/accounting/journal#zavierka", icon: "check" },
  ];

  return (
    <ol className="mb-10 grid gap-3 sm:grid-cols-2">
      {tasks.map((task, i) => (
        <li key={task.key}>
          <Card padding="none" className="h-full">
            <Link
              href={task.href}
              className="flex h-full min-h-11 items-start gap-3 rounded-xl p-4 hover:bg-ui-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ui-surface-muted text-base font-semibold text-ui-text"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-ui-text">
                  <Icon name={task.icon} size={20} />
                  {t(`${task.key}Title`)}
                  {task.status && <Badge tone={task.status.tone}>{task.status.label}</Badge>}
                </span>
                <span className="mt-1 block text-base text-ui-text-muted">
                  {t(`${task.key}Hint`)}
                </span>
              </span>
              <Icon name="chevronRight" size={20} className="mt-1 shrink-0 text-ui-text-muted" />
            </Link>
          </Card>
        </li>
      ))}
    </ol>
  );
}

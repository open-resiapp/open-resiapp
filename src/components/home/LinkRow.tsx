import type { ComponentProps, ReactNode } from "react";

import { Icon, cn, type IconName } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";

// One large tappable row: icon + visible label (+ hint) + chevron. Used by
// the board "Čo treba teraz" list and the Dom sections. Server component.

export type LinkRowTone = "default" | "warning" | "danger";

const ICON_TONE: Record<LinkRowTone, string> = {
  default: "bg-ui-surface-muted text-ui-text",
  warning: "bg-ui-warning/10 text-ui-warning",
  danger: "bg-ui-danger/10 text-ui-danger",
};

export function LinkRow({
  href,
  icon,
  label,
  hint,
  tone = "default",
  trailing,
}: {
  href: ComponentProps<typeof Link>["href"];
  icon: IconName;
  label: ReactNode;
  hint?: ReactNode;
  tone?: LinkRowTone;
  /** Extra content before the chevron (e.g. a count badge). */
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-xl border border-ui-border bg-ui-surface px-4 py-3 text-ui-text transition-colors hover:border-ui-border-strong hover:bg-ui-surface-muted",
        focusRing
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          ICON_TONE[tone]
        )}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium break-words">{label}</span>
        {hint ? <span className="block text-base text-ui-text-muted">{hint}</span> : null}
      </span>
      {trailing}
      <Icon name="chevronRight" size={20} className="shrink-0 text-ui-text-muted" />
    </Link>
  );
}

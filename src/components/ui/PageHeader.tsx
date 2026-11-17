import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn, focusRing } from "./cn";
import { Icon } from "./Icon";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  backHref?: ComponentProps<typeof Link>["href"];
  /** Visible text of the back link (required with backHref). */
  backLabel?: string;
  /** Right-aligned on ≥sm, below the title on mobile. Keep to one primary button. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, backHref, backLabel, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3", className)}>
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className={cn(
            "-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-base font-medium text-ui-text-muted hover:text-ui-text",
            focusRing,
          )}
        >
          <Icon name="chevronLeft" size={20} />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ui-text break-words">{title}</h1>
          {description ? <p className="mt-1 text-base text-ui-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

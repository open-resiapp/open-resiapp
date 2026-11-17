import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName | ReactNode;
  title: string;
  description?: ReactNode;
  /** Usually one Button / ButtonLink. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-ui-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ui-surface-muted text-ui-text-muted">
          {typeof icon === "string" ? <Icon name={icon as IconName} size={28} /> : icon}
        </span>
      ) : null}
      <h2 className="text-lg font-semibold text-ui-text">{title}</h2>
      {description ? <p className="max-w-md text-base text-ui-text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

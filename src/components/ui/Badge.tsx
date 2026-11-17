import type { ComponentProps } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ui-surface-muted text-ui-text border-ui-border",
  success: "bg-ui-success/10 text-ui-success border-ui-success/30",
  warning: "bg-ui-warning/10 text-ui-warning border-ui-warning/30",
  danger: "bg-ui-danger/10 text-ui-danger border-ui-danger/30",
  info: "bg-ui-info/10 text-ui-info border-ui-info/30",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}

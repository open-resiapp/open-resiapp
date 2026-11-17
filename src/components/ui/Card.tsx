import type { ComponentProps } from "react";
import { cn, focusRing } from "./cn";

type CardTag = "div" | "section" | "article" | "aside" | "li";

const PADDING = { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-5 sm:p-6" } as const;

export interface CardProps extends ComponentProps<"div"> {
  as?: CardTag;
  padding?: keyof typeof PADDING;
  /** Hover + focus ring styling for clickable cards. */
  interactive?: boolean;
}

export function Card({
  as = "div",
  padding = "md",
  interactive = false,
  className,
  ...rest
}: CardProps) {
  const Tag = as as "div";
  return (
    <Tag
      className={cn(
        "rounded-xl border border-ui-border bg-ui-surface text-ui-text",
        PADDING[padding],
        interactive &&
          cn(
            "transition-colors hover:border-ui-border-strong hover:bg-ui-surface-muted cursor-pointer",
            focusRing,
            "focus-within:ring-2 focus-within:ring-ui-focus",
          ),
        className,
      )}
      {...rest}
    />
  );
}

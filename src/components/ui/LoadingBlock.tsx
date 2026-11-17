"use client";

import { useTranslations } from "next-intl";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export interface LoadingBlockProps {
  /** Visible text. Defaults to Ui.loading. */
  label?: string;
  className?: string;
}

export function LoadingBlock({ label, className }: LoadingBlockProps) {
  const t = useTranslations("Ui");
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-3 py-10 text-base text-ui-text-muted",
        className,
      )}
    >
      <Spinner size={24} />
      <span>{label ?? t("loading")}</span>
    </div>
  );
}

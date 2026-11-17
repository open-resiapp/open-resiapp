"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";
import { PageHeader } from "@/components/ui";

// Owners reach the feed from "Dom" (it is not in their nav) → back link.
export default function FeedHeader({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("Feed");
  const { audience } = useShell();
  const owner = audience === "owner";
  return (
    <PageHeader
      title={t("title")}
      description={t("subtitle")}
      backHref={owner ? "/dom" : undefined}
      backLabel={owner ? t("backToHouse") : undefined}
      actions={actions}
    />
  );
}

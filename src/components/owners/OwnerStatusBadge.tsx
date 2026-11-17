"use client";

import { useTranslations } from "next-intl";

import { Badge, type BadgeTone } from "@/components/ui";
import type { OwnerStatus } from "@/lib/owners-board";

export const STATUS_TONE: Record<OwnerStatus, BadgeTone> = {
  no_account: "neutral",
  invited: "info",
  pending: "warning",
  active: "success",
};

export function OwnerStatusBadge({
  status,
  deactivated = false,
}: {
  status: OwnerStatus;
  deactivated?: boolean;
}) {
  const t = useTranslations("Owners.board");
  if (status === "active" && deactivated) {
    return <Badge tone="danger">{t("deactivated")}</Badge>;
  }
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

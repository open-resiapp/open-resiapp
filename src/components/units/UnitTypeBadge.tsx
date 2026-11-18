"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui";
import type { UnitType } from "@/lib/unit-type";

/**
 * Text badge for non-flat units ("Nebytový priestor" / "Garáž" / "Iné").
 * Flats (and units without a stored type, read as flats) render nothing.
 * Labelled text, never icon-only.
 */
export default function UnitTypeBadge({ type }: { type: UnitType | undefined }) {
  const t = useTranslations("UnitType");
  if (!type || type === "flat") return null;
  return <Badge tone="info">{t(type)}</Badge>;
}

"use client";

// Financie section navigation (BYT-20261117-002 Phase 5). Five task-based
// sections replace the 15 equal tiles. Rendered once by
// src/app/[locale]/(dashboard)/accounting/layout.tsx above every accounting
// page; hidden for anyone who cannot read the books as board (owners use
// /moje-platby and only reach their own karta / vyúčtovanie / inspect).

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Tabs } from "@/components/ui";
import { useOptionalShell } from "@/components/layout/ShellContext";
import { useAccountingAccess } from "./useAccountingAccess";

export type AccountingSection =
  | "overview"
  | "payments"
  | "expenses"
  | "annual"
  | "settings";

/** Which section an /accounting/* path belongs to (locale already stripped). */
export function sectionForPath(pathname: string): AccountingSection {
  const rest = pathname.replace(/^\/accounting\/?/, "");
  const first = rest.split("/")[0] ?? "";
  if (rest === "") return "overview";
  if (rest.startsWith("predpis/unit-settings")) return "settings";
  switch (first) {
    case "payments":
    case "reconciliation":
    case "karta":
      return "payments";
    case "expenses":
    case "inbox":
      return "expenses";
    case "predpis":
    case "meters":
    case "vyuctovanie":
      return "annual";
    default:
      // settings, journal, transfers, onboarding, debtors, revisions, inspect
      return "settings";
  }
}

export default function AccountingSectionNav() {
  const t = useTranslations("Accounting.sectionNav");
  const pathname = usePathname();
  const shell = useOptionalShell();
  const { canRead } = useAccountingAccess();

  if (
    !canRead ||
    !shell?.enabledModules.includes("accounting") ||
    !pathname.startsWith("/accounting")
  ) {
    return null;
  }

  return (
    <Tabs
      className="mb-6"
      aria-label={t("label")}
      value={sectionForPath(pathname)}
      items={[
        { value: "overview", label: t("overview"), href: "/accounting" },
        { value: "payments", label: t("payments"), href: "/accounting/payments" },
        { value: "expenses", label: t("expenses"), href: "/accounting/expenses" },
        { value: "annual", label: t("annual"), href: "/accounting/predpis" },
        { value: "settings", label: t("settings"), href: "/accounting/settings" },
      ]}
    />
  );
}

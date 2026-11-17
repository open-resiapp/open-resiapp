"use client";

// "Pre účtovníka a audit" (BYT-20261117-002 Phase 5). Statutory and
// bookkeeping pages, demoted from the landing but never removed: VS, journal
// + trial balance, fund transfers (§10 ods. 3), opening balance, debtor list,
// revízie and the owners' right to inspect (§11 ods. 6).

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, Icon } from "@/components/ui";

const LINKS = [
  { key: "vs", href: "/accounting/predpis/unit-settings" },
  { key: "journal", href: "/accounting/journal" },
  { key: "transfers", href: "/accounting/transfers" },
  { key: "opening", href: "/accounting/onboarding/opening-balance" },
  { key: "debtors", href: "/accounting/debtors" },
  { key: "revisions", href: "/accounting/revisions" },
  { key: "inspect", href: "/accounting/inspect" },
] as const;

export default function ForAccountantLinks() {
  const t = useTranslations("Accounting.forAccountant");
  return (
    <section aria-labelledby="for-accountant-title" className="mt-10">
      <h2 id="for-accountant-title" className="text-xl font-semibold text-ui-text">
        {t("title")}
      </h2>
      <p className="mb-4 mt-1 text-base text-ui-text-muted">{t("subtitle")}</p>
      <Card padding="none">
        <ul className="divide-y divide-ui-border">
          {LINKS.map((l) => (
            <li key={l.key}>
              <Link
                href={l.href}
                className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 hover:bg-ui-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
              >
                <span className="min-w-0">
                  <span className="block text-base font-medium text-ui-text">{t(`${l.key}`)}</span>
                  <span className="block text-base text-ui-text-muted">{t(`${l.key}Hint`)}</span>
                </span>
                <Icon name="chevronRight" size={20} className="shrink-0 text-ui-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

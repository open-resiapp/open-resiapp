// Owned by the accounting module — BYT-20261118-001.
// Pokročilé → Prepojenie s bankou: Enable Banking setup guide + the bank
// connection itself. Gate = accounting writer (treasurer / admin), the same
// rule as the Enable Banking API — a treasurer reaches it from the Platby
// page link even though the Pokročilé hub itself is admin-only.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import type { UserRole } from "@/types";
import { Card, PageHeader } from "@/components/ui";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import { getEnableBankingAppInfo } from "@modules/accounting/src/lib/enable-banking";
import EnableBankingSetupGuide from "@modules/accounting/src/components/EnableBankingSetupGuide";
import EnableBankingConnection from "@modules/accounting/src/components/EnableBankingConnection";

export default async function BankConnectionSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const [{ locale }, session, t, th] = await Promise.all([
    params,
    auth(),
    getTranslations("Accounting.bankConnection"),
    getTranslations("SettingsHub"),
  ]);
  if (!session?.user) {
    redirect({ href: "/login", locale });
    return null;
  }
  const root = await getCommunityRoot();
  if (
    !root ||
    !(await canWriteAccounting(session.user.id, session.user.role as string, root.id))
  ) {
    redirect({ href: "/settings", locale });
    return null;
  }

  const info = getEnableBankingAppInfo();
  const isAdmin = hasPermission(session.user.role as UserRole, "manageSettings");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        backHref={isAdmin ? "/settings/advanced" : "/accounting/payments"}
        backLabel={isAdmin ? th("backToAdvanced") : t("backToPayments")}
      />
      <EnableBankingSetupGuide {...info} />
      {info.configured && (
        <Card as="section" aria-label={t("connectionTitle")}>
          <EnableBankingConnection variant="settings" />
        </Card>
      )}
    </div>
  );
}

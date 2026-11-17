import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { PageHeader } from "@/components/ui";
import ExternalConnectionsTab from "@/components/settings/ExternalConnectionsTab";

// Same gate as the old `?tab=connections` (manageSettings).
export default async function ExternalConnectionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session, t, ts] = await Promise.all([
    params,
    auth(),
    getTranslations("SettingsHub"),
    getTranslations("Settings"),
  ]);
  if (!session?.user) {
    redirect({ href: "/login", locale });
    return null;
  }
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    redirect({ href: "/settings", locale });
    return null;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={ts("connectionsTitle")}
        backHref="/settings/advanced"
        backLabel={t("backToAdvanced")}
      />
      <ExternalConnectionsTab />
    </div>
  );
}

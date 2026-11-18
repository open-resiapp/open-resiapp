import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { Card, Icon, PageHeader, type IconName } from "@/components/ui";

// Modules, external connections, import and the setup guide all require
// `manageSettings` (their own pages / APIs enforce it too); the hub keeps
// the same gate. Caretakers (viewSettings only) go back to /settings.
const ITEMS: { key: string; href: string; icon: IconName }[] = [
  { key: "modules", href: "/settings/modules", icon: "settings" },
  { key: "connections", href: "/settings/advanced/connections", icon: "link" },
  { key: "import", href: "/admin/import", icon: "upload" },
  { key: "setupGuide", href: "/onboarding", icon: "help" },
  // Same reader members use (/zakony) — no admin-only copy.
  { key: "laws", href: "/zakony", icon: "file" },
];

export default async function AdvancedSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session, t] = await Promise.all([
    params,
    auth(),
    getTranslations("SettingsHub"),
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
    <div className="max-w-3xl">
      <PageHeader
        title={t("advancedTitle")}
        description={t("advancedIntro")}
        backHref="/settings"
        backLabel={t("backToSettings")}
      />
      <ul className="space-y-3">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
            >
              <Card interactive className="flex items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ui-surface-muted text-ui-text">
                  <Icon name={item.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold text-ui-text">{t(`advanced_${item.key}_title`)}</span>
                  <span className="block text-base text-ui-text-muted">{t(`advanced_${item.key}_desc`)}</span>
                </span>
                <Icon name="chevronRight" className="shrink-0 text-ui-text-muted" />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { Icon } from "@/components/ui";
import { isNavItemActive } from "@/lib/navigation";
import { useShell } from "@/components/layout/ShellContext";

// BYT-20261117-002 Phase 1/3. Items come from the typed nav config
// (src/lib/navigation.ts) filtered for this user; building name, template,
// logo and enabled modules come from ShellData — no fetch on mount.
//
// Board audience: static sidebar on desktop, slide-in drawer on mobile.
// Owner audience: desktop sidebar only — mobile uses <BottomTabBar>.

export default function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Sidebar");
  const tNav = useTranslations("Nav");
  const tRoot = useTranslations();
  const pathname = usePathname();
  const { community, branding, navItems, badges, audience } = useShell();

  const buildingName = community?.name || t("appName");

  // Never show a raw i18n key: displayTemplateSlug is already mapped to
  // a catalog slug (legacy kind slugs → hoa), and `has` guards the rest.
  const slug = community?.displayTemplateSlug;
  const templateKey = slug ? `Templates.${slug}.name` : null;
  const subtitle =
    templateKey && tRoot.has(templateKey) ? tRoot(templateKey) : t("appDescription");

  const isDrawer = audience === "board";

  return (
    <>
      {isDrawer && isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={
          isDrawer
            ? `fixed top-0 left-0 z-50 h-full w-72 overflow-y-auto bg-white border-r border-gray-200 transform transition-transform lg:translate-x-0 lg:static lg:z-auto lg:w-64 dark:bg-gray-900 dark:border-gray-800 ${
                isOpen ? "translate-x-0" : "-translate-x-full"
              }`
            : "hidden lg:block lg:w-64 shrink-0 bg-white border-r border-gray-200 dark:bg-gray-900 dark:border-gray-800"
        }
      >
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          {branding.logoUrl && (
            <div className="mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoUrl}
                alt={buildingName}
                className="h-10 w-auto max-w-[180px] object-contain"
              />
            </div>
          )}
          <h2 className="text-lg font-bold text-blue-700 dark:text-blue-300">{buildingName}</h2>
          <p className="text-sm text-gray-600 mt-1 dark:text-gray-300">{subtitle}</p>
        </div>

        <nav className="p-4 space-y-1" aria-label={tNav("menu")}>
          {navItems.map((item) => {
            const isActive = isNavItemActive(item, pathname);
            const count = item.badgeKey ? badges[item.badgeKey] : undefined;

            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 min-h-[48px] px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100"
                    : "text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                <Icon name={item.icon} size={22} className="shrink-0" />
                <span className="flex-1 min-w-0 truncate">{tNav(item.labelKey)}</span>
                {count ? (
                  <span
                    className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-red-600 text-white text-sm font-semibold"
                    aria-label={tNav("badgeWaiting", { count })}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

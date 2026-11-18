"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { Icon } from "@/components/ui";
import { isNavItemActive } from "@/lib/navigation";
import { useShell } from "@/components/layout/ShellContext";

/**
 * Owner audience, mobile only (< lg): fixed bottom tab bar with the owner
 * destinations (Domov · Hlasovanie · Moje platby · Dom). Icon + always
 * visible label, ≥ 56 px tall, safe-area padding. BYT-20261117-002 Phase 3.
 */
export default function BottomTabBar() {
  const tNav = useTranslations("Nav");
  const pathname = usePathname();
  const { navItems: allItems, badges } = useShell();
  // Secondary (reference) items stay out of the 4-slot tab bar.
  const navItems = allItems.filter((item) => !item.secondary);

  if (navItems.length === 0) return null;

  return (
    <nav
      aria-label={tNav("menu")}
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)] dark:bg-gray-900 dark:border-gray-800"
    >
      <ul className="flex">
        {navItems.map((item) => {
          const isActive = isNavItemActive(item, pathname);
          const count = item.badgeKey ? badges[item.badgeKey] : undefined;
          return (
            <li key={item.id} className="flex-1 min-w-0">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-16 px-1 text-base font-medium transition-colors ${
                  isActive
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                }`}
              >
                {isActive && (
                  <span
                    className="absolute top-0 inset-x-4 h-1 rounded-b bg-blue-600 dark:bg-blue-400"
                    aria-hidden="true"
                  />
                )}
                <Icon name={item.icon} size={24} />
                <span className="max-w-full truncate leading-tight">{tNav(item.labelKey)}</span>
                {count ? (
                  <span
                    className="absolute top-1 right-[calc(50%-1.75rem)] inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-red-600 text-white text-sm font-semibold"
                    aria-label={tNav("badgeWaiting", { count })}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

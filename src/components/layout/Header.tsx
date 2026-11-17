"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui";
import EntitySwitcher from "@/components/layout/EntitySwitcher";
import UserMenu from "@/components/layout/UserMenu";
import { useShell } from "@/components/layout/ShellContext";

/**
 * Top bar. Board audience gets a "Menu" button (icon + visible label) on
 * mobile that opens the sidebar drawer; owners get no hamburger — they
 * navigate with the bottom tab bar. Profile + logout live in the avatar
 * menu. BYT-20261117-002 Phase 3.
 */
export default function Header({
  onMenuToggle,
  menuOpen = false,
  showProfileLink = true,
}: {
  /** Omit to hide the menu button (owner audience, pending users). */
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  showProfileLink?: boolean;
}) {
  const t = useTranslations("Header");
  const tNav = useTranslations("Nav");
  const { user } = useShell();

  return (
    <header className="bg-white px-4 lg:px-6 py-2 border-b border-gray-200 lg:border-b-0 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between gap-3 min-h-12">
        {onMenuToggle ? (
          <button
            type="button"
            onClick={onMenuToggle}
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            aria-label={t("openMenu")}
            className="lg:hidden inline-flex items-center gap-2 min-h-11 px-3 rounded-lg text-base font-medium text-gray-800 hover:bg-gray-100 transition-colors dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <Icon name="menu" size={24} />
            <span>{tNav("menu")}</span>
          </button>
        ) : null}

        <div className="flex items-center gap-2 sm:gap-3 ml-auto min-w-0">
          <EntitySwitcher />
          <UserMenu userName={user.name} showProfile={showProfileLink} />
        </div>
      </div>
    </header>
  );
}

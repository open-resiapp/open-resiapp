"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import EntitySwitcher from "@/components/layout/EntitySwitcher";

export default function Header({
  userName,
  onMenuToggle,
  showMenu = true,
  showProfileLink = true,
}: {
  userName: string;
  onMenuToggle?: () => void;
  showMenu?: boolean;
  showProfileLink?: boolean;
}) {
  const t = useTranslations("Header");

  return (
    <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between">
        {showMenu && onMenuToggle ? (
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            aria-label={t("openMenu")}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        ) : null}

        <div className="flex items-center gap-4 ml-auto">
          <EntitySwitcher />
          <LanguageSwitcher />
          {showProfileLink ? (
            <Link
              href="/profile"
              className="text-base text-gray-700 hover:text-blue-600 transition-colors dark:text-gray-200 dark:hover:text-blue-400"
              title={t("profile")}
            >
              {userName}
            </Link>
          ) : (
            <span className="text-base text-gray-700 dark:text-gray-200">{userName}</span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="px-4 py-2 text-base text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </header>
  );
}

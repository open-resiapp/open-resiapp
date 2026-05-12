"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
    <header className="bg-white px-4 lg:px-6 py-3 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3">
        {showMenu && onMenuToggle ? (
          <button
            onClick={onMenuToggle}
            className="lg:hidden flex items-center justify-center w-10 h-10 rounded-full text-gray-700 hover:bg-gray-100 transition-colors dark:text-gray-200 dark:hover:bg-gray-800"
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

        <div className="flex items-center gap-2 sm:gap-3 ml-auto min-w-0">
          <EntitySwitcher />
          {showProfileLink ? (
            <Link
              href="/profile"
              className="inline-flex items-center h-10 px-3 sm:px-4 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors dark:text-gray-200 dark:hover:bg-gray-800 truncate max-w-[8rem] sm:max-w-none"
              title={t("profile")}
            >
              {userName}
            </Link>
          ) : (
            <span className="text-sm text-gray-700 truncate max-w-[8rem] dark:text-gray-200">{userName}</span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center h-10 px-3 sm:px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-full transition-colors dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </header>
  );
}

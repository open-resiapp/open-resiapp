"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Header({
  userName,
  onMenuToggle,
}: {
  userName: string;
  onMenuToggle: () => void;
}) {
  const t = useTranslations("Header");

  return (
    <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 text-gray-600 hover:text-gray-900"
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

        <div className="flex items-center gap-4 ml-auto">
          <LanguageSwitcher />
          <span className="text-base text-gray-700">{userName}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="px-4 py-2 text-base text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </header>
  );
}

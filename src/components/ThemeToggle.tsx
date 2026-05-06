"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "@/components/ThemeProvider";

type ThemeOption = "light" | "dark" | "system";

const OPTIONS: ThemeOption[] = ["light", "dark", "system"];

function Icon({ name }: { name: ThemeOption }) {
  if (name === "light") {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" strokeWidth={2} />
        <path
          strokeLinecap="round"
          strokeWidth={2}
          d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        />
      </svg>
    );
  }
  if (name === "dark") {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        />
      </svg>
    );
  }
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M8 20h8M12 16v4" />
    </svg>
  );
}

export default function ThemeToggle() {
  const t = useTranslations("ThemeToggle");
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t("label")}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => setTheme(opt)}
            aria-pressed={active}
            title={t(opt)}
            className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
              active
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
            }`}
          >
            <Icon name={opt} />
            <span className="sr-only">{t(opt)}</span>
          </button>
        );
      })}
    </div>
  );
}

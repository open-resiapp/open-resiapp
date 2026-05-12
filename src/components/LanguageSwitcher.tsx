"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function handleChange(newLocale: string) {
    // localStorage mirrors the NEXT_LOCALE cookie that next-intl sets so the
    // choice survives cookie clears and is readable from client code.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("locale", newLocale);
      } catch {
        // ignore quota / private-mode errors
      }
    }
    router.replace(pathname, { locale: newLocale as (typeof routing.locales)[number] });
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 p-1 rounded-full bg-gray-100 dark:bg-gray-800"
      role="group"
      aria-label="Language"
    >
      {routing.locales.map((loc) => {
        const active = locale === loc;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => handleChange(loc)}
            aria-pressed={active}
            className={`min-w-[40px] px-3 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              active
                ? "bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900"
                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            }`}
          >
            {loc.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

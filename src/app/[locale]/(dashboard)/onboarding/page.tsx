"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// RES-20260609-001. Guided setup checklist. Every step's "done" state
// is derived from /api/onboarding/status (no stored progress), so the
// page reflects real data on every load and is resumable for free.
type StepKey = "community" | "units" | "owners" | "posts";

interface OnboardingStatus {
  complete: boolean;
  steps: Record<StepKey, boolean>;
}

const STEPS: { key: StepKey; href: React.ComponentProps<typeof Link>["href"] }[] = [
  { key: "community", href: { pathname: "/settings", query: { tab: "building" } } },
  { key: "units", href: "/admin/import" },
  { key: "owners", href: "/settings/registration-qr" },
  { key: "posts", href: "/board" },
];

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const t = useTranslations("Onboarding");
  const role = (session?.user?.role || "owner") as UserRole;
  const isAdmin = hasPermission(role, "manageSettings");
  const [data, setData] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) {
      setLoading(false);
      return;
    }
    fetch("/api/onboarding/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OnboardingStatus | null) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status, isAdmin]);

  if (status === "authenticated" && !isAdmin) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        {t("noPermission")}
      </div>
    );
  }

  const doneCount = data ? STEPS.filter((s) => data.steps[s.key]).length : 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("intro")}</p>

      {!loading && data && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {t("progress", { done: doneCount, total: STEPS.length })}
        </p>
      )}

      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = data?.steps[step.key] ?? false;
          return (
            <li
              key={step.key}
              className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  done
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                }`}
                aria-hidden="true"
              >
                {done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  {t(`steps.${step.key}.title`)}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                  {t(`steps.${step.key}.body`)}
                </p>
              </div>
              <Link
                href={step.href}
                className={`shrink-0 self-center px-3 py-1.5 rounded text-sm font-medium ${
                  done
                    ? "text-blue-600 hover:text-blue-800 dark:text-blue-400"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {done ? t("review") : t("start")}
              </Link>
            </li>
          );
        })}
      </ol>

      {!loading && data?.complete && (
        <p className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {t("allDone")}
        </p>
      )}
    </div>
  );
}

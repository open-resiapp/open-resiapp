"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// RES-20260609-001. Dismissal is permanent and per-device (localStorage),
// mirroring InstallPrompt.tsx. The chairman closes it once and it stays
// gone on that browser; it also auto-vanishes once the community has
// units (the /api/onboarding/status `complete` flag).
const DISMISS_KEY = "onboardingBannerDismissed";

/**
 * Dashboard nudge toward the /onboarding setup guide. Renders nothing
 * unless the viewer is an admin AND the community is not yet set up AND
 * the banner hasn't been dismissed.
 *
 * Starts hidden and only reveals once all three gates are confirmed —
 * so a populated or dismissed community never flashes the banner on
 * navigation (RES-20260609-001 FOUC requirement).
 */
export default function OnboardingBanner() {
  const { data: session, status } = useSession();
  const t = useTranslations("OnboardingBanner");
  const role = (session?.user?.role || "owner") as UserRole;
  const isAdmin = hasPermission(role, "manageSettings");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // private mode — proceed without persisted dismissal
    }
    let active = true;
    fetch("/api/onboarding/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { complete: boolean } | null) => {
        if (active && data && !data.complete) setShow(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [status, isAdmin]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore quota / private-mode errors
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950 p-4 mb-4 text-sm text-blue-900 dark:text-blue-100">
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">
          👋
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold mb-1">{t("title")}</div>
          <p className="mb-3">{t("body")}</p>
          <Link
            href="/onboarding"
            className="inline-block px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            {t("action")}
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="shrink-0 rounded-md p-1 text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";
import { Button, ButtonLink, Icon } from "@/components/ui";

// RES-20260609-001. Dismissal is permanent and per-device (localStorage),
// mirroring InstallPrompt.tsx. The chairman closes it once and it stays
// gone on that browser; it also auto-vanishes once the community has
// units (the onboarding `complete` flag, resolved by the server layout
// into ShellData.onboarding — null for non-admins).
const DISMISS_KEY = "onboardingBannerDismissed";

/**
 * Dashboard nudge toward the /onboarding setup guide. Renders nothing
 * unless the viewer is an admin AND the community is not yet set up AND
 * the banner hasn't been dismissed.
 *
 * Starts hidden and only reveals once all three gates are confirmed —
 * so a populated or dismissed community never flashes the banner on
 * navigation (RES-20260609-001 FOUC requirement). Admin + completeness
 * come from the server (ShellData); only the per-device dismissal is
 * read client-side, in an effect.
 */
export default function OnboardingBanner() {
  const t = useTranslations("OnboardingBanner");
  const { onboarding } = useShell();
  const needsSetup = onboarding !== null && !onboarding.complete;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!needsSetup) {
      setShow(false);
      return;
    }
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // private mode — proceed without persisted dismissal
    }
    setShow(true);
  }, [needsSetup]);

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
    <section
      aria-labelledby="onboarding-banner-title"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-ui-info/40 bg-ui-info/10 p-4 text-ui-text sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon name="info" className="mt-0.5 shrink-0 text-ui-info" />
        <div className="min-w-0">
          <h2 id="onboarding-banner-title" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="mt-1 text-base text-ui-text-muted">{t("body")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <ButtonLink href="/onboarding">{t("action")}</ButtonLink>
        <Button variant="ghost" onClick={dismiss}>
          <Icon name="x" size={20} />
          {t("dismiss")}
        </Button>
      </div>
    </section>
  );
}

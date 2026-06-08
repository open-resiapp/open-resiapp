"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// `beforeinstallprompt` is not in the standard lib DOM types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "installPromptDismissedAt";
// Re-show the prompt this long after the user dismisses it, so a single "not
// now" doesn't hide it forever.
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iPadOS 13+ masquerades as Mac — detect via touch points.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/**
 * PWA install promotion. On Chrome/Android it captures the
 * `beforeinstallprompt` event and offers a one-tap install button. On iOS —
 * which has no install event — it shows manual "Add to Home Screen"
 * instructions instead. Renders nothing when already installed or dismissed.
 */
export default function InstallPrompt() {
  const t = useTranslations("InstallPrompt");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"android" | "ios" | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissedAt && Date.now() - dismissedAt < SNOOZE_MS) return;
    } catch {
      // private mode — proceed without persisted dismissal
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS never fires the event — show manual steps instead.
    if (isIos()) setMode("ios");

    // Hide once the app gets installed during this session.
    const onInstalled = () => dismiss();
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore quota / private-mode errors
    }
    setMode(null);
  }

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  }

  if (!mode) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={40} height={40} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{t("title")}</p>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {mode === "ios" ? t("iosBody") : t("body")}
            </p>

            {mode === "android" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleInstall}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {t("install")}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                >
                  {t("later")}
                </button>
              </div>
            )}

            {mode === "ios" && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                {/* iOS Share glyph */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="shrink-0 text-blue-600"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3v12m0-12L8 7m4-4l4 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t("iosShareHint")}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label={t("dismiss")}
            className="shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
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
    </div>
  );
}

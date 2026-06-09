"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

// RES-20260609-002: the structure tree (building/entrances/flats) collapsed
// into a single "structure" tab, and the admin/system links (registration QR,
// modules, import, setup guide) moved off the main bar into a "More" overflow.
export type SettingsTab =
  | "structure"
  | "branding"
  | "voting"
  | "boardMembers"
  | "connections";

interface SettingsTabsProps {
  activeTab: SettingsTab | null;
  onTabChange: (tab: SettingsTab) => void;
  alertCount?: number;
  // Admin/system links — each hidden when its flag is false. These navigate
  // to sub-pages rather than switching local state.
  showModules?: boolean;
  showRegistrationQr?: boolean;
  // RES-20260609-001: Import + the onboarding guide live here as links.
  showImport?: boolean;
  // BYT-20260512-008: white-label logo tab — admin (manageSettings) only.
  showBranding?: boolean;
}

interface AdminLink {
  href: string;
  label: string;
  match: string;
}

export default function SettingsTabs({
  activeTab,
  onTabChange,
  alertCount,
  showModules = false,
  showRegistrationQr = false,
  showImport = false,
  showBranding = false,
}: SettingsTabsProps) {
  const t = useTranslations("Settings");
  const pathname = usePathname();
  const router = useRouter();

  // Base tabs switch local state when we're on the root /settings page; on
  // sub-pages they navigate back via ?tab=... so the click isn't a no-op.
  const onSettingsRoot = pathname === "/settings";

  const baseTabs = [
    "structure",
    showBranding && "branding",
    "voting",
    "boardMembers",
    "connections",
  ].filter(Boolean) as SettingsTab[];

  const tabLabels: Record<SettingsTab, string> = {
    structure: t("tabStructure"),
    branding: t("tabBranding"),
    voting: t("tabVoting"),
    boardMembers: t("tabBoardMembers"),
    connections: t("tabConnections"),
  };

  const adminLinks = [
    showRegistrationQr && {
      href: "/settings/registration-qr",
      label: t("registrationQrLink"),
      match: "/settings/registration-qr",
    },
    showModules && {
      href: "/settings/modules",
      label: t("modulesLink"),
      match: "/settings/modules",
    },
    showImport && {
      href: "/admin/import",
      label: t("importLink"),
      match: "/admin/import",
    },
    showImport && {
      href: "/onboarding",
      label: t("setupGuideLink"),
      match: "/onboarding",
    },
  ].filter(Boolean) as AdminLink[];

  const isLinkActive = (link: AdminLink) => pathname?.startsWith(link.match) ?? false;
  const anyAdminActive = adminLinks.some(isLinkActive);

  const baseClass =
    "whitespace-nowrap py-3 px-1 border-b-2 text-base font-medium transition-colors relative";
  const activeClass = "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400";
  const inactiveClass =
    "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600";

  const connectionsBadge =
    alertCount && alertCount > 0 ? (alertCount > 9 ? "9+" : String(alertCount)) : null;

  // --- "More" overflow dropdown (desktop) ---
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // --- Mobile: a single native <select> drives the whole nav (no horizontal
  // scroll). Link items carry a "link:" sentinel so onChange can tell a
  // tab-switch apart from a navigation.
  const activeAdminLink = adminLinks.find(isLinkActive);
  const selectValue = activeAdminLink
    ? `link:${activeAdminLink.href}`
    : (activeTab ?? "structure");

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value.startsWith("link:")) {
      router.push(value.slice("link:".length));
      return;
    }
    const tab = value as SettingsTab;
    if (onSettingsRoot) {
      onTabChange(tab);
    } else {
      router.push(`/settings?tab=${tab}`);
    }
  };

  return (
    <>
      {/* Mobile / narrow: dropdown picker (the dashboard sidebar is an
          overlay below lg, so content is full-width; md is the point where
          the SK tab labels comfortably fit on one row). */}
      <div className="md:hidden mb-6">
        <label htmlFor="settings-nav" className="sr-only">
          {t("title")}
        </label>
        <select
          id="settings-nav"
          value={selectValue}
          onChange={handleSelect}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
        >
          {baseTabs.map((tab) => (
            <option key={tab} value={tab}>
              {tab === "connections" && connectionsBadge
                ? `${tabLabels[tab]} (${connectionsBadge})`
                : tabLabels[tab]}
            </option>
          ))}
          {adminLinks.length > 0 && (
            <optgroup label={t("moreLink")}>
              {adminLinks.map((link) => (
                <option key={link.href} value={`link:${link.href}`}>
                  {link.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Desktop: horizontal tab bar + "More" overflow */}
      <div className="hidden md:block border-b border-gray-200 mb-6 dark:border-gray-700">
        <nav className="-mb-px flex items-center space-x-6" aria-label="Tabs">
          {baseTabs.map((tab) => {
            const isActive = onSettingsRoot && activeTab === tab;
            const className = `${baseClass} ${isActive ? activeClass : inactiveClass}`;
            const badge =
              tab === "connections" && connectionsBadge ? (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                  {connectionsBadge}
                </span>
              ) : null;
            if (onSettingsRoot) {
              return (
                <button key={tab} onClick={() => onTabChange(tab)} className={className}>
                  {tabLabels[tab]}
                  {badge}
                </button>
              );
            }
            return (
              <Link
                key={tab}
                href={{ pathname: "/settings", query: { tab } }}
                className={className}
              >
                {tabLabels[tab]}
                {badge}
              </Link>
            );
          })}

          {adminLinks.length > 0 && (
            <div className="relative flex items-center" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className={`${baseClass} inline-flex items-center gap-1 ${
                  anyAdminActive ? activeClass : inactiveClass
                }`}
              >
                {t("moreLink")}
                <svg
                  className={`w-4 h-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/40"
                >
                  {adminLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      onClick={() => setMoreOpen(false)}
                      className={`block px-4 py-2.5 text-base transition-colors ${
                        isLinkActive(link)
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </>
  );
}

"use client";

import { Fragment, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { Icon } from "@/components/ui";
import { isNavItemActive } from "@/lib/navigation";
import { useShell } from "@/components/layout/ShellContext";

// BYT-20261117-002 Phase 1/3. Items come from the typed nav config
// (src/lib/navigation.ts) filtered for this user; building name, template,
// logo and enabled modules come from ShellData — no fetch on mount.
//
// Board audience: static sidebar on desktop, slide-in drawer on mobile.
// Owner audience: desktop sidebar only — mobile uses <BottomTabBar>.

// Same selector the shared Modal uses for its focus trap.
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const DESKTOP_QUERY = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export default function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Sidebar");
  const tNav = useTranslations("Nav");
  const tRoot = useTranslations();
  const pathname = usePathname();
  const { community, branding, navItems, badges, audience } = useShell();

  const buildingName = community?.name || t("appName");

  // Never show a raw i18n key: displayTemplateSlug is already mapped to
  // a catalog slug (legacy kind slugs → hoa), and `has` guards the rest.
  const slug = community?.displayTemplateSlug;
  const templateKey = slug ? `Templates.${slug}.name` : null;
  const subtitle =
    templateKey && tRoot.has(templateKey) ? tRoot(templateKey) : t("appDescription");

  const isDrawer = audience === "board";
  const asideRef = useRef<HTMLElement>(null);
  // The sidebar is a static column from lg up; the drawer behaviour (dialog,
  // focus trap, inert) only applies below it. Server snapshot = desktop so
  // the closed drawer is not inert-flagged before hydration.
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
  const drawerActive = isDrawer && !isDesktop;
  const drawerOpen = drawerActive && isOpen;

  // Move focus into the open drawer; give it back to the opener on close.
  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const panel = asideRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => trigger?.focus?.();
  }, [drawerOpen]);

  const onDrawerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!drawerOpen) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = asideRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {isDrawer && isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        ref={asideRef}
        tabIndex={drawerOpen ? -1 : undefined}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? tNav("menu") : undefined}
        // Closed drawer is off-screen: keep it out of tab order / a11y tree.
        inert={drawerActive && !isOpen}
        onKeyDown={onDrawerKeyDown}
        className={
          isDrawer
            ? `fixed top-0 left-0 z-50 h-full w-72 overflow-y-auto bg-white border-r border-gray-200 transform transition-transform lg:translate-x-0 lg:static lg:h-auto lg:z-auto lg:w-64 dark:bg-gray-900 dark:border-gray-800 ${
                isOpen ? "translate-x-0" : "-translate-x-full"
              }`
            : "hidden lg:block lg:w-64 shrink-0 bg-white border-r border-gray-200 dark:bg-gray-900 dark:border-gray-800"
        }
      >
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          {branding.logoUrl && (
            <div className="mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoUrl}
                alt={buildingName}
                className="h-10 w-auto max-w-[180px] object-contain"
              />
            </div>
          )}
          <h2 className="text-lg font-bold text-blue-700 dark:text-blue-300">{buildingName}</h2>
          <p className="text-base text-gray-600 mt-1 dark:text-gray-300">{subtitle}</p>
        </div>

        <nav className="p-4 space-y-1" aria-label={tNav("menu")}>
          {navItems.map((item, index) => {
            const isActive = isNavItemActive(item, pathname);
            const count = item.badgeKey ? badges[item.badgeKey] : undefined;

            // Secondary (reference) items follow the main ones after a divider.
            const startsSecondary =
              item.secondary && (index === 0 || !navItems[index - 1].secondary);

            return (
              <Fragment key={item.id}>
                {startsSecondary ? (
                  <hr className="my-3 border-gray-200 dark:border-gray-800" />
                ) : null}
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 min-h-[48px] px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100"
                      : "text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  }`}
                >
                  <Icon name={item.icon} size={22} className="shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{tNav(item.labelKey)}</span>
                  {count ? (
                    <span
                      className="inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-full bg-red-600 text-white text-base font-semibold"
                      aria-label={tNav("badgeWaiting", { count })}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              </Fragment>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

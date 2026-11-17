"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ui";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Avatar + name button that opens a small menu: Profil, Odhlásiť sa.
 * Replaces the bare logout link in the header (BYT-20261117-002 Phase 3).
 * `showProfile=false` for pending users (they only get logout).
 */
export default function UserMenu({
  userName,
  showProfile = true,
}: {
  userName: string;
  showProfile?: boolean;
}) {
  const t = useTranslations("Header");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }

  const itemClass =
    "flex items-center gap-3 min-h-12 w-full px-4 py-2 text-left text-base text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("userMenu", { name: userName })}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex items-center gap-2 min-h-11 pl-1 pr-2 sm:pr-3 rounded-full text-base font-medium text-gray-800 hover:bg-gray-100 transition-colors dark:text-gray-100 dark:hover:bg-gray-800"
      >
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold dark:bg-blue-900/60 dark:text-blue-100"
          aria-hidden="true"
        >
          {initials(userName)}
        </span>
        <span className="hidden sm:inline truncate max-w-[12rem]">{userName}</span>
        <Icon name="chevronDown" size={18} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 min-w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="px-4 py-2 text-sm text-gray-600 truncate sm:hidden dark:text-gray-300">
            {userName}
          </div>
          {showProfile ? (
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <Icon name="user" size={20} />
              {t("profile")}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={itemClass}
          >
            <Icon name="logout" size={20} />
            {t("logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

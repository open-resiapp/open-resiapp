"use client";

import { useEffect, useId, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn, focusRing } from "./cn";

export interface TabItem {
  value: string;
  label: string;
  /** If set, the tab renders as a link (navigation) instead of a button. */
  href?: ComponentProps<typeof Link>["href"];
  /** Count / short text shown after the label. */
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  /** Called on click and on arrow-key activation of button tabs. */
  onChange?: (value: string) => void;
  /** Accessible name of the tablist. */
  "aria-label"?: string;
  className?: string;
}

/** Id of the tab for `value`, for `aria-labelledby` on the panel: `${idBase}-tab-${value}`. */
export function Tabs({ items, value, onChange, className, "aria-label": ariaLabel }: TabsProps) {
  const idBase = useId();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible inside the scroll container (never scrolls the page).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const list = listRef.current;
    if (!el || !list) return;
    const left = el.offsetLeft - 16;
    const right = el.offsetLeft + el.offsetWidth + 16;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    const item = items[next];
    // Link tabs only move focus; Enter/click navigates. Button tabs activate on focus.
    if (item && !item.href) onChange?.(item.value);
  };

  return (
    <div className={cn("max-w-full border-b border-ui-border", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="-mb-px flex max-w-full gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const selected = item.value === value;
          const common = {
            role: "tab" as const,
            id: `${idBase}-tab-${item.value}`,
            "aria-selected": selected,
            tabIndex: selected ? 0 : -1,
            className: cn(
              "relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-base font-medium transition-colors",
              focusRing,
              selected
                ? "border-ui-primary text-ui-text"
                : "border-transparent text-ui-text-muted hover:border-ui-border-strong hover:text-ui-text",
            ),
          };
          const content = (
            <>
              {item.label}
              {item.badge != null ? (
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-ui-surface-muted px-1.5 text-sm text-ui-text">
                  {item.badge}
                </span>
              ) : null}
            </>
          );
          return item.href ? (
            <Link key={item.value} href={item.href} aria-current={selected ? "page" : undefined} {...common}>
              {content}
            </Link>
          ) : (
            <button key={item.value} type="button" onClick={() => onChange?.(item.value)} {...common}>
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn, focusRing } from "./cn";
import { Icon } from "./Icon";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Shared counter so stacked modals keep the lock until the last one closes.
let lockCount = 0;
let prevOverflow = "";
function lockScroll() {
  if (lockCount++ === 0) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (--lockCount === 0) document.body.style.overflow = prevOverflow;
}

const subscribeNoop = () => () => {};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Override aria-label of the close button (default Ui.close). */
  closeLabel?: string;
  /** Close on backdrop click (default true). */
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel,
  closeOnBackdrop = true,
}: ModalProps) {
  const t = useTranslations("Ui");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const visible = open && mounted;

  useEffect(() => {
    if (!visible) return;
    const trigger = document.activeElement as HTMLElement | null;
    lockScroll();
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(`:is(${FOCUSABLE}):not([data-modal-close])`) ??
      panel;
    target?.focus();
    return () => {
      unlockScroll();
      trigger?.focus?.();
    };
  }, [visible]);

  if (!visible) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-ui-overlay"
        aria-hidden="true"
        onMouseDown={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[90dvh] w-full flex-col overflow-hidden bg-ui-surface text-ui-text shadow-xl outline-none",
          "rounded-t-2xl border border-ui-border sm:max-w-lg sm:rounded-2xl",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ui-border px-5 py-3">
          <h2 id={titleId} className="py-2 text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            aria-label={closeLabel ?? t("close")}
            className={cn(
              "-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ui-text-muted hover:bg-ui-surface-muted hover:text-ui-text",
              focusRing,
            )}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-base">{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-ui-border px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import {
  LAW_FONT_SIZES,
  readFontSize,
  writeFontSize,
  writeProgress,
  type LawFontSize,
} from "@/lib/laws-progress";

// The only client JS of the reader:
//  - font size (3 explicit buttons), remembered per viewer;
//  - one delegated click listener for every server-rendered
//    <button data-copy-anchor> (copies the stable /zakony/<id>/p/<anchor>
//    resolver URL, which survives chapter re-splits);
//  - "continue where you left off": remembers chapter + the provision at
//    the top of the viewport.
// Everything degrades to a plain readable page without JS or storage.

export interface LawReaderControlsProps {
  lawId: string;
  chapter: number;
  /** Id of the element whose data-size drives the reading font size. */
  readerId: string;
  /** Size read from the cookie on the server (already painted via data-size); null = never chosen. */
  initialSize: LawFontSize | null;
  /** Locale-prefixed path to the anchor resolver, e.g. "/sk/zakony/sk-182-1993/p/". */
  resolverBase: string;
  labels: {
    fontSize: string;
    sizes: Record<LawFontSize, string>;
    copied: string; // contains "{label}"
    copyFailed: string;
  };
}

export function LawReaderControls({ lawId, chapter, readerId, initialSize, resolverBase, labels }: LawReaderControlsProps) {
  const [size, setSize] = useState<LawFontSize>(initialSize ?? "md");
  const [status, setStatus] = useState("");

  // One-time migration: a size remembered in localStorage before the cookie
  // existed. With a cookie the server already rendered the right size.
  useEffect(() => {
    if (initialSize) return;
    const stored = readFontSize();
    if (stored) {
      setSize(stored);
      writeFontSize(stored);
    }
  }, [initialSize]);

  // Idempotent: no-op when the server already painted this size.
  useEffect(() => {
    const el = document.getElementById(readerId);
    if (el && el.dataset.size !== size) el.dataset.size = size;
  }, [size, readerId]);

  // Copy-link buttons (event delegation).
  useEffect(() => {
    const onClick = async (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>("[data-copy-anchor]");
      if (!btn) return;
      const anchor = btn.dataset.copyAnchor ?? "";
      const label = btn.dataset.copyLabel ?? anchor;
      const url = `${window.location.origin}${resolverBase}${encodeURIComponent(anchor)}`;
      try {
        await navigator.clipboard.writeText(url);
        setStatus(labels.copied.replace("{label}", label));
      } catch {
        setStatus(labels.copyFailed);
      }
      // Also reflect the target in the address bar (no navigation).
      try {
        window.history.replaceState(window.history.state, "", `#${anchor}`);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [resolverBase, labels.copied, labels.copyFailed]);

  // Clear the status line after a moment.
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(""), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  // Reading progress: chapter + first provision visible at the top.
  useEffect(() => {
    const save = () => {
      const provisions = document.querySelectorAll<HTMLElement>(`#${CSS.escape(readerId)} [data-law-provision]`);
      let anchor: string | undefined;
      for (const p of provisions) {
        if (p.getBoundingClientRect().bottom > 80) {
          anchor = p.id;
          break;
        }
      }
      writeProgress(lawId, { chapter, at: Date.now(), ...(anchor ? { anchor } : {}) });
    };
    save();
    let timer: number | undefined;
    const onScroll = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        save();
      }, 1000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [lawId, chapter, readerId]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={`${readerId}-size-label`} className="text-base text-ui-text-muted">
        {labels.fontSize}
      </span>
      <div role="group" aria-labelledby={`${readerId}-size-label`} className="inline-flex gap-1">
        {LAW_FONT_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={size === s}
            onClick={() => {
              setSize(s);
              writeFontSize(s);
            }}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 font-medium",
              s === "sm" ? "text-sm" : s === "md" ? "text-base" : "text-lg",
              size === s
                ? "border-ui-primary bg-ui-primary text-ui-primary-text"
                : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted",
              focusRing,
            )}
          >
            {labels.sizes[s]}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="basis-full text-base text-ui-success empty:hidden">
        {status}
      </p>
    </div>
  );
}

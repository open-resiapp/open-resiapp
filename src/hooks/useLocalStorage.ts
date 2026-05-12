"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drop-in `useState` replacement that persists to `localStorage`.
 *
 * - SSR-safe: reads `localStorage` only after mount; initial render uses
 *   `initialValue` so server and client markup agree.
 * - Cross-tab sync: subscribes to the `storage` event so a value written
 *   in another tab propagates here.
 * - Quota / SSR errors swallowed — the in-memory state still works.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValueState] = useState<T>(initialValue);
  const hydrated = useRef(false);

  // Read on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        setValueState(JSON.parse(raw) as T);
      }
    } catch {
      /* corrupted entry — ignore, keep initial */
    }
    hydrated.current = true;
  }, [key]);

  // Write on change.
  useEffect(() => {
    if (!hydrated.current || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded or storage disabled — give up silently */
    }
  }, [key, value]);

  // Cross-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValueState(JSON.parse(e.newValue) as T);
      } catch {
        /* ignore malformed broadcast */
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) =>
        typeof next === "function" ? (next as (p: T) => T)(prev) : next
      );
    },
    []
  );

  return [value, setValue];
}

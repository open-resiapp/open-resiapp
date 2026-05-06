"use client";

import { useEffect, useState, useTransition } from "react";

interface RootOption {
  id: string;
  name: string;
  kind: string;
}

interface SessionState {
  cookieValue: string | null;
  resolved: string | null;
}

/**
 * Header-mounted dropdown that lets a user switch their active entity
 * scope when they hold memberships in more than one root tree.
 * Hidden when the user has 0 or 1 accessible roots.
 *
 * RES-20260501-002 §"Multi-tree memberships allowed".
 */
export default function EntitySwitcher() {
  const [roots, setRoots] = useState<RootOption[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rootsRes, sessionRes] = await Promise.all([
          fetch("/api/session/roots", { credentials: "include" }),
          fetch("/api/session/current-entity", { credentials: "include" }),
        ]);
        if (!rootsRes.ok || !sessionRes.ok) return;
        const rootsData = (await rootsRes.json()) as RootOption[];
        const sessionData = (await sessionRes.json()) as SessionState;
        if (cancelled) return;
        setRoots(rootsData);
        setCurrent(sessionData.resolved);
      } catch {
        // Silent fail — switcher is optional UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!roots || roots.length <= 1) return null;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const entityId = event.target.value;
    setCurrent(entityId);
    startTransition(async () => {
      await fetch("/api/session/current-entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityId }),
      });
      // Reload so server components pick up the new scope.
      window.location.reload();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={current ?? ""}
        onChange={handleChange}
        disabled={isPending}
        className="text-sm border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
        aria-label="Active entity"
      >
        {roots.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

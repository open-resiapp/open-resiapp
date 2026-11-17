"use client";

import { createContext, useContext, useMemo } from "react";

import { getVisibleNavItems, type NavItem } from "@/lib/navigation";
import type { ShellData } from "@/lib/shell";

// BYT-20261117-002 Phase 1. The dashboard server layout resolves
// `ShellData` once per request and provides it here. Consumers read it
// synchronously — no fetch on mount. After a mutation that changes shell
// data (consent, entity switch, branding/building edit, module toggle)
// call `router.refresh()` so the server layout re-resolves it.

export interface ShellContextValue extends ShellData {
  /** Nav items visible to this user, in display order. */
  navItems: NavItem[];
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  data,
  children,
}: {
  data: ShellData;
  children: React.ReactNode;
}) {
  const value = useMemo<ShellContextValue>(
    () => ({
      ...data,
      navItems: getVisibleNavItems(data.user, { enabledModules: data.enabledModules }),
    }),
    [data]
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Shell data for the dashboard. Throws outside the (dashboard) layout. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell() must be used inside <ShellProvider>");
  return ctx;
}

/** Same as useShell() but returns null outside the dashboard layout. */
export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}

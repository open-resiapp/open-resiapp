"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";

/**
 * Header-mounted dropdown that lets a user switch their active entity
 * scope when they hold memberships in more than one root tree.
 * Hidden when the user has 0 or 1 accessible roots.
 *
 * RES-20260501-002 §"Multi-tree memberships allowed".
 * BYT-20261117-002: options + current id come from ShellData (server
 * layout); after a switch `router.refresh()` re-resolves the layout and
 * server components instead of a full page reload.
 */
export default function EntitySwitcher() {
  const t = useTranslations("Header");
  const { entities } = useShell();
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (entities.options.length <= 1) return null;

  const current = isPending && optimistic ? optimistic : entities.currentId;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const entityId = event.target.value;
    setOptimistic(entityId);
    startTransition(async () => {
      const res = await fetch("/api/session/current-entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityId }),
      }).catch(() => null);
      // Nested transition keeps `isPending` (and the optimistic value)
      // until the refreshed server layout has landed.
      if (res?.ok) startTransition(() => router.refresh());
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={current ?? ""}
        onChange={handleChange}
        disabled={isPending}
        className="h-11 text-base border border-gray-300 rounded-lg px-2 bg-white text-gray-900 max-w-[10rem] sm:max-w-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
        aria-label={t("activeEntity")}
      >
        {entities.options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

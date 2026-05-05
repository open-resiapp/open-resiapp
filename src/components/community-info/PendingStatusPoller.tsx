"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";

const POLL_INTERVAL_MS = 30_000;

export default function PendingStatusPoller() {
  const { update } = useSession();
  const router = useRouter();
  const updateRef = useRef(update);
  const routerRef = useRef(router);
  const polling = useRef(false);

  updateRef.current = update;
  routerRef.current = router;

  useEffect(() => {
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      cancelled = true;
      if (id) {
        clearInterval(id);
        id = null;
      }
    };

    const tick = async () => {
      if (cancelled || polling.current) return;
      polling.current = true;
      try {
        const res = await fetch("/api/me/status", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (cancelled) return;
        if (data.status === "active") {
          stop();
          await updateRef.current();
          routerRef.current.replace("/");
        }
      } catch {
        // silent — try again next tick
      } finally {
        polling.current = false;
      }
    };

    tick();
    id = setInterval(tick, POLL_INTERVAL_MS);
    return stop;
  }, []);

  return null;
}

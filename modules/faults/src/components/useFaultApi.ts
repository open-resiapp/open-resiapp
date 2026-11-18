"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { isFaultErrorCode } from "../engine/transitions";

// Client fetch helper for the faults API: maps `{ error: FAULT_* }` to the
// `Faults.errors.*` catalog; anything else → generic message.

export function useFaultApi() {
  const t = useTranslations("Faults");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async <T = unknown>(url: string, init: RequestInit): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, init);
        const body = (await res.json().catch(() => null)) as
          | (T & { error?: unknown })
          | null;
        if (!res.ok) {
          const code = body?.error;
          setError(isFaultErrorCode(code) ? t(`errors.${code}`) : t("errors.generic"));
          return null;
        }
        return body as T;
      } catch {
        setError(t("errors.generic"));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  return { call, busy, error, setError };
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

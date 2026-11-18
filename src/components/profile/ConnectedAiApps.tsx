"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button, Card, ConfirmDialog, LoadingBlock } from "@/components/ui";
import AiConnectGuide from "@/components/profile/AiConnectGuide";

// Profile → "Pripojené AI aplikácie" (BYT-20261117-001 §2). Renders nothing
// while the `mcp` module is disabled (the API answers 404); ProfileView
// only mounts it when the shell lists `mcp` as enabled.

interface Grant {
  familyId: string;
  clientName: string;
  clientId: string;
  logoUri: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const SCOPE_KEYS: Record<string, string> = {
  read: "read",
  "finance:read": "finance_read",
  "finance:write": "finance_write",
  "governance:write": "governance_write",
  vote: "vote",
};

export default function ConnectedAiApps({ mcpUrl }: { mcpUrl: string | null }) {
  const t = useTranslations("Mcp.profile");
  const tScopes = useTranslations("Mcp.scopeNames");
  const format = useFormatter();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/ai-apps");
      if (res.status === 404) {
        setEnabled(false);
        return;
      }
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { grants: Grant[] };
      setGrants(data.grants);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/profile/ai-apps?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("revoke");
      setConfirmId(null);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  const toRevoke = grants?.find((g) => g.familyId === confirmId) ?? null;

  return (
    <Card as="section" aria-labelledby="ai-apps-heading">
      <h2 id="ai-apps-heading" className="mb-1 text-xl font-bold text-ui-text">
        {t("title")}
      </h2>
      <p className="mb-4 text-base text-ui-text-muted">{t("description")}</p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-ui-danger px-4 py-3 text-base text-ui-danger"
        >
          {t("error")}
        </div>
      )}

      {grants === null ? (
        <LoadingBlock />
      ) : grants.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-ui-border">
          {grants.map((g) => (
            <li
              key={g.familyId}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex gap-3">
                {g.logoUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.logoUri}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg object-contain"
                  />
                )}
                <div>
                  <p className="text-base font-semibold text-ui-text">{g.clientName}</p>
                  <p className="text-base text-ui-text-muted">
                    {t("scopes")}:{" "}
                    {g.scopes.map((s) => (SCOPE_KEYS[s] ? tScopes(SCOPE_KEYS[s]) : s)).join(", ")}
                  </p>
                  <p className="text-base text-ui-text-muted">
                    {g.lastUsedAt
                      ? t("lastUsed", {
                          date: format.dateTime(new Date(g.lastUsedAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })
                      : t("neverUsed")}
                  </p>
                </div>
              </div>
              <Button variant="secondary" onClick={() => setConfirmId(g.familyId)} disabled={busy}>
                {t("revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {grants !== null ? (
        <div className={grants.length === 0 ? "mt-4" : "mt-2"}>
          <AiConnectGuide mcpUrl={mcpUrl} collapsible={grants.length > 0} />
        </div>
      ) : null}

      <ConfirmDialog
        open={toRevoke !== null}
        tone="danger"
        title={t("revoke")}
        description={t("revokeConsequence", { name: toRevoke?.clientName ?? "" })}
        confirmLabel={t("confirmRevoke")}
        cancelLabel={t("cancel")}
        loading={busy}
        onConfirm={() => toRevoke && revoke(toRevoke.familyId)}
        onCancel={() => setConfirmId(null)}
      />
    </Card>
  );
}

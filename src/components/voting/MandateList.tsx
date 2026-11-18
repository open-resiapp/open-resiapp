"use client";

// Board view of the powers of attorney recorded for one voting, with the
// revoke (undo) path for each — DELETE /api/mandates?id=… (board only,
// voting not closed, mandate not yet used by a ballot / attendance row).
// Fetched once on mount and again after a create / revoke (`reloadKey`);
// not live.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, useConfirm } from "@/components/ui";

interface MandateRow {
  id: string;
  fromOwnerName: string | null;
  fromFlatNumber: string | null;
  toOwnerName: string | null;
  isExternalProxy: boolean;
}

export default function MandateList({
  votingId,
  canRevoke,
  reloadKey,
  onChanged,
}: {
  votingId: string;
  /** Board (admin / chairman) and the voting is not closed. */
  canRevoke: boolean;
  /** Bump to refetch (e.g. after MandateModal created one). */
  reloadKey: number;
  onChanged?: () => void;
}) {
  const t = useTranslations("Mandate");
  const confirm = useConfirm();
  const [rows, setRows] = useState<MandateRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorText = useCallback(
    (code: unknown): string => {
      const key = `errors.${String(code ?? "")}`;
      return typeof code === "string" && t.has(key) ? t(key as never) : t("list.revokeFailed");
    },
    [t]
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/mandates?votingId=${encodeURIComponent(votingId)}`).catch(() => null);
    setRows(res?.ok ? ((await res.json()) as MandateRow[]) : []);
  }, [votingId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function revoke(m: MandateRow) {
    const ok = await confirm({
      title: t("list.revokeConfirmTitle"),
      description: t("list.revokeConfirmText", {
        from: m.fromOwnerName ?? "—",
        to: m.toOwnerName ?? "—",
      }),
      confirmLabel: t("list.revoke"),
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(m.id);
    setError(null);
    try {
      const res = await fetch(`/api/mandates?id=${encodeURIComponent(m.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(errorText(body.error));
        return;
      }
      await load();
      onChanged?.();
    } catch {
      setError(t("list.revokeFailed"));
    } finally {
      setBusyId(null);
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <Card as="section" className="mb-6 space-y-3" aria-labelledby="mandate-list-heading">
      <h3 id="mandate-list-heading" className="text-lg font-bold text-ui-text">
        {t("list.heading")}
      </h3>
      {error && (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-ui-border">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base text-ui-text">
              {t("list.row", {
                from: m.fromOwnerName ?? "—",
                flat: m.fromFlatNumber ?? "—",
                to: m.toOwnerName ?? "—",
              })}
              {m.isExternalProxy && (
                <span className="block text-ui-text-muted">{t("list.externalProxy")}</span>
              )}
            </p>
            {canRevoke && (
              <Button
                variant="secondary"
                onClick={() => void revoke(m)}
                loading={busyId === m.id}
                disabled={busyId !== null}
              >
                {t("list.revoke")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

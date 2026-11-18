"use client";

// "Všetky platby" tab (BYT-20261117-002; list from BYT-20260512-002 slice 3).
// Rows render as stacked cards on mobile and a compact grid on desktop.
// Corrections are voids with a mandatory reason — never edits (domain
// invariant 4/5); the void dialog states the consequence.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input } from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";

export interface PaymentRow {
  id: string;
  receivedAt: string;
  amountCents: number;
  allocatedCents: number;
  vs: string | null;
  unitName: string | null;
  unitFlatNumber: string | null;
  narrative: string | null;
  source: "manual" | "bank_import" | "fio_api" | "enable_banking_api";
  voidedAt: string | null;
  voidReason: string | null;
}

export default function PaymentsList({
  rows,
  canWrite,
  onChanged,
}: {
  rows: PaymentRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("Accounting.payments");
  const format = useFormatter();

  const [voidTarget, setVoidTarget] = useState<PaymentRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitVoid() {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setReasonMissing(true);
      return;
    }
    setVoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/payments/${voidTarget.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setVoidTarget(null);
      setVoidReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "void");
    } finally {
      setVoiding(false);
    }
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon="wallet" title={t("empty")} />
      </Card>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-base font-medium text-ui-danger">
          {t("submitError")} ({error})
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((p) => {
          const voided = !!p.voidedAt;
          return (
            <li key={p.id}>
              <Card padding="sm" className={voided ? "opacity-70" : undefined}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-base font-medium text-ui-text">
                      <span className={voided ? "line-through" : undefined}>
                        {formatEur(p.amountCents)}
                      </span>
                      <span className="ml-2 font-normal text-ui-text-muted">
                        {t("unitLabel", { unit: p.unitFlatNumber ?? p.unitName ?? "—" })}
                      </span>
                    </p>
                    <p className="text-base text-ui-text-muted">
                      {format.dateTime(new Date(p.receivedAt), { dateStyle: "medium" })}
                      {p.vs ? ` · ${t("vsLabel", { vs: p.vs })}` : ""}
                      {" · "}
                      {t(`source_${p.source}`)}
                    </p>
                    {voided ? (
                      <p className="text-base text-ui-text-muted">
                        <Badge tone="neutral">{t("voidedLabel")}</Badge>{" "}
                        {p.voidReason}
                      </p>
                    ) : (
                      <>
                        {/* "Allocated" counts only payment_allocations. A part
                            that found nothing due parks as preplatok (Cr 379)
                            — the karta bytu already shows it as a credit, so
                            say so instead of a bare 0,00 €. */}
                        {p.unitFlatNumber === null && p.unitName === null ? (
                          <p className="text-base text-ui-text-muted">{t("unassignedLine")}</p>
                        ) : (
                          <p className="text-base text-ui-text-muted">
                            {t("allocatedLine", { amount: formatEur(p.allocatedCents) })}
                            {p.amountCents > p.allocatedCents &&
                              ` · ${t("creditLine", {
                                amount: formatEur(p.amountCents - p.allocatedCents),
                              })}`}
                          </p>
                        )}
                        {p.narrative && (
                          <p className="break-words text-base text-ui-text-muted">{p.narrative}</p>
                        )}
                      </>
                    )}
                  </div>
                  {canWrite && !voided && (
                    <Button
                      variant="ghost"
                      className="self-start text-ui-danger sm:self-center"
                      onClick={() => {
                        setVoidTarget(p);
                        setVoidReason("");
                        setReasonMissing(false);
                      }}
                    >
                      {t("void")}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={voidTarget !== null}
        tone="danger"
        title={t("voidTitle")}
        confirmLabel={voiding ? t("voiding") : t("voidYes")}
        cancelLabel={t("voidNo")}
        loading={voiding}
        onCancel={() => setVoidTarget(null)}
        onConfirm={submitVoid}
        description={
          <div className="space-y-3">
            <p>
              {voidTarget &&
                t("voidConsequence", {
                  amount: formatEur(voidTarget.amountCents),
                  unit: voidTarget.unitFlatNumber ?? voidTarget.unitName ?? "—",
                })}
            </p>
            <Field
              label={t("voidReasonLabel")}
              required
              error={reasonMissing ? t("voidReasonRequired") : undefined}
            >
              <Input
                value={voidReason}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  setReasonMissing(false);
                }}
                placeholder={t("voidReasonPlaceholder")}
              />
            </Field>
          </div>
        }
      />
    </>
  );
}

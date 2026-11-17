"use client";

// "Zaevidovať platbu" dialog (BYT-20261117-002; form from BYT-20260512-002
// slice 3). Same fields and the same POST /api/accounting/payments call as
// the old inline form. A recorded payment allocates automatically across
// the unit's open assessments; the breakdown is shown right after saving.
// Anything above the open total parks as preplatok.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { parseCents, formatEur } from "@modules/accounting/src/lib/money";

export interface PaymentUnitOption {
  id: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
}

interface CreateResult {
  paymentId: string;
  allocatedCents: number;
  unallocatedCents: number;
  allocations: {
    amountCents: number;
    month: number;
    periodYear: number;
    categorySlug: string;
  }[];
}

export default function ManualPaymentModal({
  open,
  onClose,
  units,
  presetUnitId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** null while the unit list is still loading. */
  units: PaymentUnitOption[] | null;
  presetUnitId?: string | null;
  onSaved: () => void;
}) {
  const t = useTranslations("Accounting.payments");
  const tCat = useTranslations("Accounting.serviceCategories");

  const today = new Date().toISOString().slice(0, 10);
  const [unitId, setUnitId] = useState("");
  const [method, setMethod] = useState<"bank" | "cash">("bank");
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(today);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  // Pick the preset (?unit=) when it names a real unit, else the first one.
  useEffect(() => {
    if (!open || !units || units.length === 0) return;
    setUnitId((prev) => {
      if (prev && units.some((u) => u.id === prev)) return prev;
      if (presetUnitId && units.some((u) => u.id === presetUnitId)) return presetUnitId;
      return units[0].id;
    });
  }, [open, units, presetUnitId]);

  const amountCents = parseCents(amount);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(receivedAt) && receivedAt <= today;
  const formValid = unitId !== "" && amountCents !== null && amountCents > 0 && dateValid;

  function close() {
    setResult(null);
    setError(null);
    onClose();
  }

  async function submit() {
    if (!formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitEntityId: unitId,
          amountCents,
          receivedAt: new Date(`${receivedAt}T00:00:00Z`).toISOString(),
          method,
          note: note.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setResult(body);
      setAmount("");
      setNote("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : close}
      title={t("newPayment")}
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={() => setResult(null)}>
              {t("another")}
            </Button>
            <Button onClick={close}>{t("done")}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={submitting}>
              {t("voidNo")}
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!formValid}>
              {t("save")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-base text-ui-text" role="status">
          <p className="font-medium">
            {t("allocatedSummary", { allocated: formatEur(result.allocatedCents) })}
          </p>
          {result.allocations.length > 0 && (
            <ul className="space-y-0.5">
              {result.allocations.map((a, i) => (
                <li key={i}>
                  {a.periodYear}-{String(a.month).padStart(2, "0")}{" "}
                  {tCat(a.categorySlug as Parameters<typeof tCat>[0])}: {formatEur(a.amountCents)}
                </li>
              ))}
            </ul>
          )}
          {result.unallocatedCents > 0 && (
            <p>{t("preplatokNote", { amount: formatEur(result.unallocatedCents) })}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("unit")} required>
            <Select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!units}
            >
              {(units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.flatNumber ?? u.name}
                  {u.vs ? ` (${t("vsLabel", { vs: u.vs })})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("amount")} required>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              invalid={amount.trim() !== "" && (amountCents === null || amountCents <= 0)}
            />
          </Field>
          <Field label={t("receivedAt")} required error={!dateValid ? t("dateInvalid") : undefined}>
            <Input
              type="date"
              value={receivedAt}
              max={today}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </Field>
          <Field label={t("method")}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as "bank" | "cash")}>
              <option value="bank">{t("methodBank")}</option>
              <option value="cash">{t("methodCash")}</option>
            </Select>
          </Field>
          <Field label={t("note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-base font-medium text-ui-danger">
              {t("submitError")} ({error})
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

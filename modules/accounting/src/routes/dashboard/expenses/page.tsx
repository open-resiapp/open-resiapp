"use client";

// Faktúry a výdavky (BYT-20261117-002 Phase 5; ledger from BYT-20260512-002
// Phase 3). List first. "Nahrať faktúru" (primary) feeds the OCR inbox shown
// on top as "Na spracovanie (N)"; "Zadať ručne" opens the invoice form in a
// dialog. Per row: one "Uhradiť" (asks bank or cash) + a menu with Doklady
// and Stornovať. Paying posts Dr 321 / Cr banka|pokladnica; corrections are
// voids with a reason (never edits — invariants 4/5).

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
} from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import ExpenseAttachments from "@modules/accounting/src/components/ExpenseAttachments";
import ExpenseFormModal, {
  type ExpenseCategory,
  type ExpensePrefill,
} from "@modules/accounting/src/components/ExpenseFormModal";
import ExpenseInbox from "@modules/accounting/src/components/ExpenseInbox";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

interface ExpenseRow {
  id: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  categorySlug: string | null;
  okruh: "fpuo" | "svc" | "mgmt";
  amountCents: number;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  attachmentVisibility: "public" | "redacted_required" | "restricted";
}

export default function ExpensesPage() {
  const t = useTranslations("Accounting.expenses");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();
  const { canWrite } = useAccountingAccess();
  const uploadInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inboxReload, setInboxReload] = useState(0);

  // dialogs
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState<ExpensePrefill | null>(null);
  const [payTarget, setPayTarget] = useState<ExpenseRow | null>(null);
  const [payMethod, setPayMethod] = useState<"bank" | "cash">("bank");
  const [voidTarget, setVoidTarget] = useState<ExpenseRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/accounting/expenses")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { expenses: ExpenseRow[]; categories: ExpenseCategory[] }) => {
        setRows(data.expenses);
        setCategories(data.categories);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  async function pay() {
    if (!payTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/accounting/expenses/${payTarget.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: payMethod }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setPayTarget(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "pay");
      setPayTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitVoid() {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setReasonMissing(true);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/accounting/expenses/${voidTarget.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setVoidTarget(null);
      setVoidReason("");
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "void");
      setVoidTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      title={t("title")}
      description={t("subtitle")}
      actions={
        canWrite ? (
          <>
            <Button onClick={() => uploadInput.current?.click()}>{t("uploadInvoice")}</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPrefill(null);
                setFormOpen(true);
              }}
            >
              {t("enterManually")}
            </Button>
          </>
        ) : undefined
      }
    />
  );

  return (
    <div className="max-w-5xl">
      {header}

      {canWrite && (
        <ExpenseInbox
          inputRef={uploadInput}
          reloadKey={inboxReload}
          onPost={(p) => {
            setPrefill(p);
            setFormOpen(true);
          }}
        />
      )}

      {actionError && (
        <p role="alert" className="mb-4 text-base font-medium text-ui-danger">
          {t("submitError")} ({actionError})
        </p>
      )}

      <h2 className="mb-3 text-lg font-semibold text-ui-text">{t("listTitle")}</h2>
      {loadError ? (
        <p className="text-base text-ui-danger">{t("loadError")}</p>
      ) : !rows ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon="file" title={t("empty")} description={canWrite ? t("emptyHint") : undefined} />
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => {
            const voided = !!e.voidedAt;
            const payable = canWrite && !voided && !e.paidAt;
            const menu = [
              {
                label: attachOpen === e.id ? t("attachmentsHide") : t("attachmentsToggle"),
                onSelect: () => setAttachOpen((p) => (p === e.id ? null : e.id)),
              },
              ...(canWrite
                ? [
                    {
                      label: t("void"),
                      tone: "danger" as const,
                      onSelect: () => {
                        setVoidTarget(e);
                        setVoidReason("");
                        setReasonMissing(false);
                      },
                    },
                  ]
                : []),
            ];
            return (
              <li key={e.id}>
                <Card padding="sm" className={voided ? "opacity-70" : undefined}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-baseline gap-x-3 text-base">
                        <span className={`font-medium text-ui-text ${voided ? "line-through" : ""}`}>
                          {e.supplierName}
                        </span>
                        <span className={`font-medium tabular-nums text-ui-text ${voided ? "line-through" : ""}`}>
                          {formatEur(e.amountCents)}
                        </span>
                      </p>
                      <p className="text-base text-ui-text-muted">
                        {format.dateTime(new Date(e.invoiceDate), { dateStyle: "medium" })}
                        {" · "}
                        {t("invoiceNoShort", { no: e.invoiceNo })}
                        {" · "}
                        {e.categorySlug
                          ? tCat(e.categorySlug as Parameters<typeof tCat>[0])
                          : t("uncategorized")}
                      </p>
                      <p className="flex flex-wrap items-center gap-2">
                        {voided ? (
                          <>
                            <Badge tone="neutral">{t("voidedLabel")}</Badge>
                            <span className="text-base text-ui-text-muted">{e.voidReason}</span>
                          </>
                        ) : e.paidAt ? (
                          <Badge tone="success">{t("paidLabel")}</Badge>
                        ) : (
                          <Badge tone="warning">{t("unpaidLabel")}</Badge>
                        )}
                        {e.okruh === "fpuo" && <Badge tone="info">{t("fpuoBadge")}</Badge>}
                      </p>
                    </div>
                    {!voided && (
                      <div className="flex shrink-0 items-center gap-2">
                        {payable && (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setPayMethod("bank");
                              setPayTarget(e);
                            }}
                          >
                            {t("pay")}
                          </Button>
                        )}
                        <ActionMenu
                          items={menu}
                          label={t("actionsFor", { supplier: e.supplierName })}
                        />
                      </div>
                    )}
                  </div>
                  {attachOpen === e.id && !voided && (
                    <div className="mt-3 border-t border-ui-border pt-3">
                      <ExpenseAttachments expenseId={e.id} visibility={e.attachmentVisibility} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <ExpenseFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          categories={categories}
          prefill={prefill}
          onSaved={() => {
            load();
            if (prefill) setInboxReload((n) => n + 1);
          }}
        />
      )}

      <ConfirmDialog
        open={payTarget !== null}
        title={t("payTitle")}
        confirmLabel={t("pay")}
        loading={busy}
        onCancel={() => setPayTarget(null)}
        onConfirm={pay}
        description={
          <div className="space-y-3">
            <p>
              {payTarget &&
                t("payConsequence", {
                  amount: formatEur(payTarget.amountCents),
                  supplier: payTarget.supplierName,
                })}
            </p>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-base font-medium text-ui-text">{t("payFrom")}</legend>
              {(["bank", "cash"] as const).map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-3 text-base text-ui-text">
                  <input
                    type="radio"
                    name="pay-method"
                    value={m}
                    checked={payMethod === m}
                    onChange={() => setPayMethod(m)}
                    className="h-5 w-5"
                  />
                  {m === "bank" ? t("payFromBank") : t("payFromCash")}
                </label>
              ))}
            </fieldset>
          </div>
        }
      />

      <ConfirmDialog
        open={voidTarget !== null}
        tone="danger"
        title={t("voidTitle")}
        confirmLabel={t("voidYes")}
        cancelLabel={t("voidNo")}
        loading={busy}
        onCancel={() => setVoidTarget(null)}
        onConfirm={submitVoid}
        description={
          <div className="space-y-3">
            <p>
              {voidTarget &&
                t("voidConsequence", {
                  amount: formatEur(voidTarget.amountCents),
                  supplier: voidTarget.supplierName,
                })}
            </p>
            <Field
              label={t("voidReasonLabel")}
              required
              error={reasonMissing ? t("voidReasonRequired") : undefined}
            >
              <Input
                value={voidReason}
                onChange={(ev) => {
                  setVoidReason(ev.target.value);
                  setReasonMissing(false);
                }}
                placeholder={t("voidReasonPlaceholder")}
              />
            </Field>
          </div>
        }
      />
    </div>
  );
}

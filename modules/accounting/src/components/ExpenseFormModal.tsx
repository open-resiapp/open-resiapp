"use client";

// Supplier-invoice form in a dialog (BYT-20261117-002 Phase 5; fields and
// rules from BYT-20260512-002 Phase 3 / AC 440 / AC 469 / AC 478-479).
// Used for both "Zadať ručne" (multipart POST /api/accounting/expenses with
// the mandatory scan) and posting an uploaded invoice from the inbox
// (POST /api/accounting/expense-inbox/:id/post — the parked scan becomes the
// doklad's attachment).
//
// Visible up front: dodávateľ, suma s DPH, dátum faktúry, sken. Everything
// else sits under "Ďalšie údaje". Nothing is relaxed: IČO, DIČ, IBAN, číslo
// faktúry, netto + DPH stay mandatory (and the server re-checks them). If a
// required field inside the disclosure is missing on save, the disclosure
// opens and the field shows its error.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { centsToInput, parseCents } from "@modules/accounting/src/lib/money";
import { isValidIban } from "@modules/accounting/src/lib/iban";

export interface ExpenseCategory {
  id: string;
  slug: string;
  okruh: "fpuo" | "svc" | "mgmt";
}

/** Where a dated invoice books (lib/periods.ts getPeriodBookingInfo). */
export interface PeriodBooking {
  openYears: number[];
  lockedYears: number[];
  fallbackYear: number | null;
}

/** OCR suggestions from an inbox item (all optional). */
export interface ExpensePrefill {
  inboxItemId: string;
  fileName: string;
  ico: string | null;
  dic: string | null;
  iban: string | null;
  vs: string | null;
  amountCents: number | null;
}

interface FormState {
  supplierName: string;
  supplierIco: string;
  supplierDic: string;
  supplierIban: string;
  invoiceNo: string;
  invoiceDate: string;
  categoryId: string;
  okruh: "fpuo" | "svc";
  amount: string;
  amountNetto: string;
  dph: string;
  dueDate: string;
  nextInspection: string;
  isRecurring: boolean;
}

type FieldKey = keyof FormState | "file";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

function initialState(prefill: ExpensePrefill | null): FormState {
  return {
    supplierName: "",
    supplierIco: prefill?.ico ?? "",
    supplierDic: prefill?.dic ?? "",
    supplierIban: prefill?.iban ?? "",
    // VS is often the invoice number — offered as a prefill hint.
    invoiceNo: prefill?.vs ?? "",
    invoiceDate: today(),
    categoryId: "",
    okruh: "svc",
    amount: prefill?.amountCents != null ? centsToInput(prefill.amountCents) : "",
    amountNetto: "",
    dph: "",
    dueDate: "",
    nextInspection: "",
    isRecurring: false,
  };
}

// Fields that live inside the "Ďalšie údaje" disclosure.
const MORE_FIELDS: FieldKey[] = [
  "supplierIco",
  "supplierDic",
  "supplierIban",
  "invoiceNo",
  "categoryId",
  "okruh",
  "amountNetto",
  "dph",
  "dueDate",
  "nextInspection",
  "isRecurring",
];

export default function ExpenseFormModal({
  open,
  onClose,
  categories,
  periodBooking = null,
  prefill,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategory[];
  /** Enables the "invoice year is locked" warning (fix 2026-11-18). */
  periodBooking?: PeriodBooking | null;
  /** Set when posting an uploaded invoice from the inbox. */
  prefill: ExpensePrefill | null;
  onSaved: () => void;
}) {
  const t = useTranslations("Accounting.expenses");
  const tf = useTranslations("Accounting.expenseForm");
  const tCat = useTranslations("Accounting.serviceCategories");

  const [form, setForm] = useState<FormState>(() => initialState(prefill));
  const [file, setFile] = useState<File | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<
    "notFound" | "notConfigured" | "debtor" | "error" | null
  >(null);

  // Fresh form every time the dialog opens (or switches inbox item).
  const prefillId = prefill?.inboxItemId ?? null;
  useEffect(() => {
    if (!open) return;
    setForm(initialState(prefill));
    setFile(null);
    setMoreOpen(false);
    setShowErrors(false);
    setSubmitError(null);
    setLookupNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillId]);

  const fromInbox = prefill !== null;

  // An invoice dated in a year that is not open (vyúčtovanie published /
  // závierka closed, or no period at all) books into the fallback open
  // year and is settled in THAT year's vyúčtovanie — say so up front.
  const invoiceYear = DATE_RE.test(form.invoiceDate)
    ? Number(form.invoiceDate.slice(0, 4))
    : null;
  const bookingYear =
    periodBooking && invoiceYear !== null && !periodBooking.openYears.includes(invoiceYear)
      ? periodBooking.fallbackYear
      : null;
  const yearWarning =
    bookingYear !== null && bookingYear !== invoiceYear
      ? periodBooking!.lockedYears.includes(invoiceYear!)
        ? tf("invoiceYearLocked", { year: invoiceYear!, target: bookingYear })
        : tf("invoiceYearNoPeriod", { year: invoiceYear!, target: bookingYear })
      : null;
  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const isRevizia = !!selectedCategory?.slug?.startsWith("REVIZIA_");

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      // Category drives the fund: an FPÚO category = fund spending.
      if (k === "categoryId") {
        const cat = categories.find((c) => c.id === v);
        if (cat) next.okruh = cat.okruh === "fpuo" ? "fpuo" : "svc";
      }
      return next;
    });
  }

  const amountCents = parseCents(form.amount);
  const nettoCents = form.amountNetto.trim() ? parseCents(form.amountNetto) : null;
  const dphCents = form.dph.trim() ? parseCents(form.dph) : null;

  // Same rules as before the redesign (AC 440 / 469), now per field.
  const errors: Partial<Record<FieldKey, string>> = {};
  const required = tf("required");
  if (!form.supplierName.trim()) errors.supplierName = required;
  if (amountCents === null || amountCents <= 0) errors.amount = tf("amountInvalid");
  if (!DATE_RE.test(form.invoiceDate)) errors.invoiceDate = required;
  if (!fromInbox && file === null) errors.file = tf("fileRequired");
  if (!form.supplierIco.trim()) errors.supplierIco = required;
  if (!form.supplierDic.trim()) errors.supplierDic = required;
  if (!form.supplierIban.trim()) errors.supplierIban = required;
  else if (!isValidIban(form.supplierIban)) errors.supplierIban = tf("ibanInvalid");
  if (!form.invoiceNo.trim()) errors.invoiceNo = required;
  if (!form.amountNetto.trim()) errors.amountNetto = required;
  else if (nettoCents === null) errors.amountNetto = tf("amountInvalid");
  if (!form.dph.trim()) errors.dph = required;
  else if (dphCents === null) errors.dph = tf("amountInvalid");
  if (
    nettoCents !== null &&
    dphCents !== null &&
    amountCents !== null &&
    nettoCents + dphCents !== amountCents
  ) {
    errors.dph = t("nettoMismatch");
  }
  if (isRevizia && !DATE_RE.test(form.nextInspection)) errors.nextInspection = required;

  const err = (k: FieldKey) => (showErrors ? errors[k] : undefined);

  async function submit() {
    const keys = Object.keys(errors) as FieldKey[];
    if (keys.length > 0) {
      setShowErrors(true);
      if (keys.some((k) => MORE_FIELDS.includes(k))) setMoreOpen(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      supplierName: form.supplierName.trim(),
      supplierIco: form.supplierIco.trim(),
      supplierDic: form.supplierDic.trim(),
      supplierIban: form.supplierIban.trim(),
      invoiceNo: form.invoiceNo.trim(),
      invoiceDate: new Date(`${form.invoiceDate}T00:00:00Z`).toISOString(),
      dueDate: DATE_RE.test(form.dueDate)
        ? new Date(`${form.dueDate}T00:00:00Z`).toISOString()
        : null,
      serviceCategoryId: form.categoryId || null,
      okruh: form.okruh,
      amountCents,
      amountNettoCents: nettoCents,
      dphCents,
      nextInspectionDueAt:
        isRevizia && DATE_RE.test(form.nextInspection)
          ? new Date(`${form.nextInspection}T00:00:00Z`).toISOString()
          : null,
      isRecurring: form.isRecurring,
    };
    try {
      let res: Response;
      if (prefill) {
        res = await fetch(`/api/accounting/expense-inbox/${prefill.inboxItemId}/post`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // Multipart: JSON fields + the mandatory invoice scan (AC 440).
        const fd = new FormData();
        fd.append("payload", JSON.stringify(payload));
        fd.append("file", file!);
        res = await fetch("/api/accounting/expenses", { method: "POST", body: fd });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      onSaved();
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupIco() {
    if (!form.supplierIco.trim()) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const res = await fetch(
        `/api/accounting/supplier-lookup?ico=${encodeURIComponent(form.supplierIco.trim())}`
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      if (body.status === "not_configured") setLookupNote("notConfigured");
      else if (body.status === "invalid_ico" || body.status === "provider_error") setLookupNote("error");
      else if (!body.info.found) setLookupNote("notFound");
      else {
        if (body.info.name) set("supplierName", body.info.name);
        if (body.info.debtFlag) setLookupNote("debtor");
      }
    } catch {
      setLookupNote("error");
    } finally {
      setLookingUp(false);
    }
  }

  const hiddenErrorCount = showErrors
    ? MORE_FIELDS.filter((k) => errors[k] !== undefined).length
    : 0;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      closeOnBackdrop={false}
      title={fromInbox ? tf("titleInbox") : tf("titleManual")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("voidNo")}
          </Button>
          <Button onClick={submit} loading={submitting}>
            {submitting ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {fromInbox && (
          <p className="text-base text-ui-text-muted">
            {tf("inboxFileNote", { file: prefill.fileName })}
          </p>
        )}
        <Field label={t("supplier")} required error={err("supplierName")}>
          <Input value={form.supplierName} onChange={(e) => set("supplierName", e.target.value)} />
        </Field>
        <Field label={t("amountBrutto")} required error={err("amount")}>
          <Input
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
            placeholder={t("amountPlaceholder")}
            inputMode="decimal"
          />
        </Field>
        <Field label={t("invoiceDate")} required error={err("invoiceDate")}>
          <Input
            type="date"
            value={form.invoiceDate}
            onChange={(e) => set("invoiceDate", e.target.value)}
          />
        </Field>
        {yearWarning && (
          <p role="status" className="text-base text-ui-warning">
            {yearWarning}
          </p>
        )}
        {!fromInbox && (
          <Field label={t("attachmentLabel")} required hint={t("attachmentHint")} error={err("file")}>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        )}

        <details
          open={moreOpen}
          onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-lg border border-ui-border"
        >
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-base font-medium text-ui-text">
            <span>{tf("more")}</span>
            {hiddenErrorCount > 0 && (
              <span className="text-base font-medium text-ui-danger">
                {tf("moreErrors", { count: hiddenErrorCount })}
              </span>
            )}
          </summary>
          <div className="space-y-4 border-t border-ui-border p-3">
            <p className="text-base text-ui-text-muted">{tf("moreHint")}</p>
            <Field label={t("ico")} required error={err("supplierIco")}>
              <div className="flex gap-2">
                <Input
                  value={form.supplierIco}
                  onChange={(e) => {
                    set("supplierIco", e.target.value);
                    setLookupNote(null);
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={lookupIco}
                  loading={lookingUp}
                  disabled={!form.supplierIco.trim()}
                >
                  {lookingUp ? t("lookupBusy") : t("lookup")}
                </Button>
              </div>
            </Field>
            {lookupNote && (
              <p
                className={
                  lookupNote === "debtor"
                    ? "text-base font-medium text-ui-danger"
                    : "text-base text-ui-text-muted"
                }
              >
                {t(`lookup_${lookupNote}`)}
              </p>
            )}
            <Field label={t("dic")} required error={err("supplierDic")}>
              <Input value={form.supplierDic} onChange={(e) => set("supplierDic", e.target.value)} />
            </Field>
            <Field label={t("supplierIban")} required error={err("supplierIban")}>
              <Input
                value={form.supplierIban}
                onChange={(e) => set("supplierIban", e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label={t("invoiceNo")} required error={err("invoiceNo")}>
              <Input value={form.invoiceNo} onChange={(e) => set("invoiceNo", e.target.value)} />
            </Field>
            <Field label={t("category")}>
              <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">{t("uncategorized")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {tCat(c.slug as Parameters<typeof tCat>[0])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("okruh")} hint={tf("fundHint")}>
              <Select
                value={form.okruh}
                onChange={(e) => set("okruh", e.target.value as "fpuo" | "svc")}
              >
                <option value="svc">{t("okruhSvc")}</option>
                <option value="fpuo">{t("okruhFpuo")}</option>
              </Select>
            </Field>
            {isRevizia && (
              <Field label={t("nextInspectionLabel")} required error={err("nextInspection")}>
                <Input
                  type="date"
                  value={form.nextInspection}
                  onChange={(e) => set("nextInspection", e.target.value)}
                />
              </Field>
            )}
            <Field label={t("amountNetto")} required error={err("amountNetto")}>
              <Input
                value={form.amountNetto}
                onChange={(e) => set("amountNetto", e.target.value)}
                placeholder={t("amountPlaceholder")}
                inputMode="decimal"
              />
            </Field>
            <Field label={t("dph")} required error={err("dph")}>
              <Input
                value={form.dph}
                onChange={(e) => set("dph", e.target.value)}
                placeholder={t("amountPlaceholder")}
                inputMode="decimal"
              />
            </Field>
            <Field label={t("dueDate")}>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </Field>
            <label className="flex min-h-11 items-start gap-3 text-base">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => set("isRecurring", e.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span>
                <span className="block text-ui-text">{t("recurringLabel")}</span>
                <span className="block text-ui-text-muted">{t("recurringHint")}</span>
              </span>
            </label>
          </div>
        </details>

        {submitError && (
          <p role="alert" className="text-base font-medium text-ui-danger">
            {t("submitError")} ({submitError})
          </p>
        )}
      </div>
    </Modal>
  );
}

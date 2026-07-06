"use client";

// Expense ledger (BYT-20260512-002 Phase 3). Manual supplier-invoice
// entry: brutto is authoritative, netto+DPH recorded for the doklad;
// FPÚO expenses draw the fund down, services expenses collect for the
// vyúčtovanie. Paying posts Dr 321 / Cr banka|pokladnica; corrections
// are voids with a reason.

import { Fragment, useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { parseCents, formatEur } from "@modules/accounting/src/lib/money";
import ExpenseAttachments from "@modules/accounting/src/components/ExpenseAttachments";

interface Category {
  id: string;
  slug: string;
  okruh: "fpuo" | "svc" | "mgmt";
}

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

  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  // form
  const [supplierName, setSupplierName] = useState("");
  const [supplierIco, setSupplierIco] = useState("");
  const [supplierDic, setSupplierDic] = useState("");
  const [supplierIban, setSupplierIban] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [categoryId, setCategoryId] = useState("");
  const [okruh, setOkruh] = useState<"fpuo" | "svc">("svc");
  const [amount, setAmount] = useState("");
  const [amountNetto, setAmountNetto] = useState("");
  const [dph, setDph] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [nextInspection, setNextInspection] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<
    "notFound" | "notConfigured" | "debtor" | "error" | null
  >(null);

  // row actions
  const [attachOpen, setAttachOpen] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/accounting/expenses")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { expenses: ExpenseRow[]; categories: Category[] }) => {
        setRows(data.expenses);
        setCategories(data.categories);
      })
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isRevizia = !!selectedCategory?.slug?.startsWith("REVIZIA_");

  // Category drives okruh: FPUO category = fund spending.
  useEffect(() => {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) setOkruh(cat.okruh === "fpuo" ? "fpuo" : "svc");
  }, [categoryId, categories]);

  const amountCents = parseCents(amount);
  const amountNettoCents = amountNetto.trim() ? parseCents(amountNetto) : null;
  const dphCents = dph.trim() ? parseCents(dph) : null;
  const nettoDphConsistent =
    amountNettoCents === null ||
    dphCents === null ||
    amountCents === null ||
    amountNettoCents + dphCents === amountCents;
  const formValid =
    supplierName.trim() !== "" &&
    supplierIco.trim() !== "" &&
    supplierDic.trim() !== "" &&
    supplierIban.trim() !== "" &&
    invoiceNo.trim() !== "" &&
    amountCents !== null &&
    amountCents > 0 &&
    // netto + DPH are required on a supplier invoice (AC 440).
    amountNetto.trim() !== "" &&
    amountNettoCents !== null &&
    dph.trim() !== "" &&
    dphCents !== null &&
    nettoDphConsistent &&
    /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) &&
    // The invoice scan is a required part of the doklad (AC 440).
    file !== null &&
    // A revízia expense needs its next-inspection date (AC 469).
    (!isRevizia || /^\d{4}-\d{2}-\d{2}$/.test(nextInspection));

  async function submit() {
    if (!formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      // Multipart: JSON fields + the mandatory invoice scan (AC 440).
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          supplierName: supplierName.trim(),
          supplierIco: supplierIco.trim() || null,
          supplierDic: supplierDic.trim() || null,
          supplierIban: supplierIban.trim() || null,
          invoiceNo: invoiceNo.trim(),
          invoiceDate: new Date(`${invoiceDate}T00:00:00Z`).toISOString(),
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
            ? new Date(`${dueDate}T00:00:00Z`).toISOString()
            : null,
          serviceCategoryId: categoryId || null,
          okruh,
          amountCents,
          amountNettoCents,
          dphCents,
          nextInspectionDueAt:
            isRevizia && /^\d{4}-\d{2}-\d{2}$/.test(nextInspection)
              ? new Date(`${nextInspection}T00:00:00Z`).toISOString()
              : null,
          isRecurring,
        })
      );
      form.append("file", file!);
      const res = await fetch("/api/accounting/expenses", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSupplierName("");
      setSupplierIco("");
      setSupplierDic("");
      setSupplierIban("");
      setInvoiceNo("");
      setAmount("");
      setAmountNetto("");
      setDph("");
      setNextInspection("");
      setIsRecurring(false);
      setFile(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupIco() {
    if (!supplierIco.trim()) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const res = await fetch(
        `/api/accounting/supplier-lookup?ico=${encodeURIComponent(supplierIco.trim())}`
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      if (body.status === "not_configured") {
        setLookupNote("notConfigured");
      } else if (body.status === "invalid_ico" || body.status === "provider_error") {
        setLookupNote("error");
      } else if (!body.info.found) {
        setLookupNote("notFound");
      } else {
        if (body.info.name) setSupplierName(body.info.name);
        if (body.info.debtFlag) setLookupNote("debtor");
      }
    } catch {
      setLookupNote("error");
    } finally {
      setLookingUp(false);
    }
  }

  async function pay(id: string, method: "bank" | "cash") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expenses/${id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "pay");
    } finally {
      setBusy(null);
    }
  }

  async function submitVoid() {
    if (!voidTarget || !voidReason.trim()) return;
    setBusy(voidTarget);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expenses/${voidTarget}/void`, {
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
      setError(err instanceof Error ? err.message : "void");
    } finally {
      setBusy(null);
    }
  }

  if (error === "load") {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!rows) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const inputClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm";

  return (
    <div className="max-w-5xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {/* New expense */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("newExpense")}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("supplier")} *
            </span>
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("ico")} *
            </span>
            <span className="flex gap-2">
              <input
                value={supplierIco}
                onChange={(e) => {
                  setSupplierIco(e.target.value);
                  setLookupNote(null);
                }}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={lookupIco}
                disabled={lookingUp || !supplierIco.trim()}
                className="px-3 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg disabled:opacity-50 text-xs whitespace-nowrap"
              >
                {lookingUp ? t("lookupBusy") : t("lookup")}
              </button>
            </span>
            {lookupNote && (
              <span
                className={`text-xs ${
                  lookupNote === "debtor"
                    ? "text-red-600 dark:text-red-400 font-medium"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {t(`lookup_${lookupNote}`)}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("dic")} *
            </span>
            <input
              value={supplierDic}
              onChange={(e) => setSupplierDic(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("supplierIban")} *
            </span>
            <input
              value={supplierIban}
              onChange={(e) => setSupplierIban(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("invoiceNo")} *
            </span>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("invoiceDate")} *
            </span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("category")}
            </span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {tCat(c.slug as Parameters<typeof tCat>[0])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("okruh")}
            </span>
            <select
              value={okruh}
              onChange={(e) => setOkruh(e.target.value as "fpuo" | "svc")}
              className={inputClass}
            >
              <option value="svc">{t("okruhSvc")}</option>
              <option value="fpuo">{t("okruhFpuo")}</option>
            </select>
          </label>
          {isRevizia && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-700 dark:text-gray-300">
                {t("nextInspectionLabel")} *
              </span>
              <input
                type="date"
                value={nextInspection}
                onChange={(e) => setNextInspection(e.target.value)}
                className={inputClass}
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("amountBrutto")} *
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={`${inputClass} text-right`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("amountNetto")} *
            </span>
            <input
              value={amountNetto}
              onChange={(e) => setAmountNetto(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={`${inputClass} text-right`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("dph")} *
            </span>
            <input
              value={dph}
              onChange={(e) => setDph(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={`${inputClass} text-right`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("dueDate")}
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-gray-700 dark:text-gray-300">
              {t("recurringLabel")}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("recurringHint")}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("attachmentLabel")} *
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-gray-700 dark:text-gray-300"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("attachmentHint")}
            </span>
          </label>
          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={submitting || !formValid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {submitting ? t("saving") : t("save")}
            </button>
          </div>
        </div>
        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("submitError")} ({error})
          </p>
        )}
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colDate")}</th>
                <th className="py-2 pr-4">{t("colSupplier")}</th>
                <th className="py-2 pr-4">{t("colInvoice")}</th>
                <th className="py-2 pr-4">{t("colCategory")}</th>
                <th className="py-2 pr-4 text-right">{t("colAmount")}</th>
                <th className="py-2 pr-4">{t("colStatus")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <Fragment key={e.id}>
                <tr
                  className={`border-b border-gray-100 dark:border-gray-800 ${
                    e.voidedAt ? "opacity-50 line-through" : ""
                  }`}
                >
                  <td className="py-2 pr-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                    {format.dateTime(new Date(e.invoiceDate), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {e.supplierName}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {e.invoiceNo}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {e.categorySlug
                      ? tCat(e.categorySlug as Parameters<typeof tCat>[0])
                      : t("uncategorized")}
                    {e.okruh === "fpuo" && (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 no-underline">
                        {t("fpuoBadge")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                    {formatEur(e.amountCents)}
                  </td>
                  <td className="py-2 pr-4">
                    {e.voidedAt ? (
                      <span className="no-underline text-gray-500 dark:text-gray-400">
                        {t("voidedLabel")}: {e.voidReason}
                      </span>
                    ) : e.paidAt ? (
                      <span className="text-green-700 dark:text-green-400">
                        {t("paidLabel")}
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        {t("unpaidLabel")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!e.voidedAt && !e.paidAt && (
                      <>
                        <button
                          onClick={() => pay(e.id, "bank")}
                          disabled={busy === e.id}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-xs mr-3 disabled:opacity-50"
                        >
                          {t("markPaid")}
                        </button>
                        <button
                          onClick={() => pay(e.id, "cash")}
                          disabled={busy === e.id}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-xs mr-3 disabled:opacity-50"
                        >
                          {t("markPaidCash")}
                        </button>
                      </>
                    )}
                    {!e.voidedAt && (
                      <button
                        onClick={() =>
                          setAttachOpen((p) => (p === e.id ? null : e.id))
                        }
                        className="text-gray-600 dark:text-gray-300 hover:underline text-xs mr-3"
                      >
                        📎 {t("attachmentsToggle")}
                      </button>
                    )}
                    {!e.voidedAt && (
                      <button
                        onClick={() => {
                          setVoidTarget(e.id);
                          setVoidReason("");
                        }}
                        className="text-red-600 dark:text-red-400 hover:underline text-xs"
                      >
                        {t("void")}
                      </button>
                    )}
                  </td>
                </tr>
                {attachOpen === e.id && !e.voidedAt && (
                  <tr>
                    <td colSpan={7} className="pb-3 px-2">
                      <ExpenseAttachments
                        expenseId={e.id}
                        visibility={e.attachmentVisibility}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>

          {voidTarget && (
            <div className="mt-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm">
              <p className="text-red-900 dark:text-red-200 mb-2">
                {t("voidConfirm")}
              </p>
              <div className="flex items-center gap-3">
                <input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder={t("voidReasonPlaceholder")}
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={submitVoid}
                  disabled={busy === voidTarget || !voidReason.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {t("voidYes")}
                </button>
                <button
                  onClick={() => setVoidTarget(null)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
                >
                  {t("voidNo")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// Expense collector inbox (BYT-20260512-002 AC 478/479). Treasurer drops an
// invoice PDF/image → OCR (pdf-parse text layer, or tesseract on images when
// installed) parks a pending row with suggested IČO / IBAN / VS / amount →
// the treasurer reviews the prefilled form and posts it as a real expense in
// two clicks (expand-confirm, then save). OCR fields are suggestions only;
// the parked scan becomes the doklad's mandatory attachment (AC 440).
//
// The email-inbound half of AC 478 (collector address + SES/Postmark + AV +
// allowlist, AC 480) stays BLOCKED — needs mail + AV infra.

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { parseCents, formatEur, centsToInput } from "@modules/accounting/src/lib/money";

interface Category {
  id: string;
  slug: string;
  okruh: "fpuo" | "svc" | "mgmt";
}

interface InboxItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  ocrEngine: string | null;
  ocrIco: string | null;
  ocrDic: string | null;
  ocrIban: string | null;
  ocrVs: string | null;
  ocrAmountCents: number | null;
  ocrConfidencePct: number | null;
  status: string;
  createdAt: string;
}

interface PostForm {
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
  nextInspection: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ExpenseInboxPage() {
  const t = useTranslations("Accounting.inbox");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<PostForm | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/accounting/expense-inbox").then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch("/api/accounting/expenses").then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    ])
      .then(([inbox, exp]) => {
        setItems(inbox.items);
        setCategories(exp.categories);
      })
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // Upload each file sequentially (each is OCR'd server-side).
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/accounting/expense-inbox", {
          method: "POST",
          body: fd,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? String(res.status));
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload");
    } finally {
      setUploading(false);
    }
  }

  function openPost(item: InboxItem) {
    if (openId === item.id) {
      setOpenId(null);
      setForm(null);
      return;
    }
    setOpenId(item.id);
    setForm({
      supplierName: "",
      supplierIco: item.ocrIco ?? "",
      supplierDic: item.ocrDic ?? "",
      supplierIban: item.ocrIban ?? "",
      // VS is often the invoice number — offer it as a prefill hint.
      invoiceNo: item.ocrVs ?? "",
      invoiceDate: today(),
      categoryId: "",
      okruh: "svc",
      amount: item.ocrAmountCents != null ? centsToInput(item.ocrAmountCents) : "",
      amountNetto: "",
      dph: "",
      nextInspection: "",
    });
  }

  const selectedCategory = categories.find((c) => c.id === form?.categoryId);
  const isRevizia = !!selectedCategory?.slug?.startsWith("REVIZIA_");

  function setField<K extends keyof PostForm>(k: K, v: PostForm[K]) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [k]: v };
      if (k === "categoryId") {
        const cat = categories.find((c) => c.id === v);
        if (cat) next.okruh = cat.okruh === "fpuo" ? "fpuo" : "svc";
      }
      return next;
    });
  }

  const amountCents = form ? parseCents(form.amount) : null;
  const nettoCents = form && form.amountNetto.trim() ? parseCents(form.amountNetto) : null;
  const dphCents = form && form.dph.trim() ? parseCents(form.dph) : null;
  const nettoDphConsistent =
    nettoCents === null || dphCents === null || amountCents === null
      ? true
      : nettoCents + dphCents === amountCents;
  const formValid =
    !!form &&
    form.supplierName.trim() !== "" &&
    form.supplierIco.trim() !== "" &&
    form.supplierDic.trim() !== "" &&
    form.supplierIban.trim() !== "" &&
    form.invoiceNo.trim() !== "" &&
    amountCents !== null &&
    amountCents > 0 &&
    form.amountNetto.trim() !== "" &&
    nettoCents !== null &&
    form.dph.trim() !== "" &&
    dphCents !== null &&
    nettoDphConsistent &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.invoiceDate) &&
    (!isRevizia || /^\d{4}-\d{2}-\d{2}$/.test(form.nextInspection));

  async function post(id: string) {
    if (!form || !formValid) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expense-inbox/${id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: form.supplierName.trim(),
          supplierIco: form.supplierIco.trim(),
          supplierDic: form.supplierDic.trim(),
          supplierIban: form.supplierIban.trim(),
          invoiceNo: form.invoiceNo.trim(),
          invoiceDate: new Date(`${form.invoiceDate}T00:00:00Z`).toISOString(),
          serviceCategoryId: form.categoryId || null,
          okruh: form.okruh,
          amountCents,
          amountNettoCents: nettoCents,
          dphCents,
          nextInspectionDueAt:
            isRevizia && /^\d{4}-\d{2}-\d{2}$/.test(form.nextInspection)
              ? new Date(`${form.nextInspection}T00:00:00Z`).toISOString()
              : null,
          isRecurring: false,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setOpenId(null);
      setForm(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "post");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expense-inbox/${id}/dismiss`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      if (openId === id) {
        setOpenId(null);
        setForm(null);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "dismiss");
    } finally {
      setBusy(null);
    }
  }

  if (error === "load") {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!items) {
    return <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />;
  }

  const inputClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm";

  return (
    <div className="max-w-5xl">
      <Link href="/accounting" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {/* Drop-zone upload */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-gray-700 dark:text-gray-300 font-medium">
            {uploading ? t("uploading") : t("uploadLabel")}
          </span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading}
            onChange={onUpload}
            className="text-sm text-gray-700 dark:text-gray-300"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">{t("uploadHint")}</span>
        </label>
      </div>

      {error && error !== "load" && (
        <p className="text-red-600 dark:text-red-400 text-sm mb-4">
          {t("actionError")} ({error})
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-gray-900 dark:text-gray-100 font-medium truncate">
                    📄 {item.fileName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                    {" · "}
                    {item.ocrEngine === "none" || item.ocrConfidencePct === 0
                      ? t("ocrNone")
                      : t("ocrConfidence", { pct: item.ocrConfidencePct ?? 0 })}
                  </p>
                  {/* OCR suggestions */}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {item.ocrIco && <span>IČO: {item.ocrIco}</span>}
                    {item.ocrIban && <span className="font-mono">{item.ocrIban}</span>}
                    {item.ocrVs && <span>VS: {item.ocrVs}</span>}
                    {item.ocrAmountCents != null && <span>{formatEur(item.ocrAmountCents)}</span>}
                  </div>
                </div>
                <div className="flex gap-3 whitespace-nowrap">
                  <button
                    onClick={() => openPost(item)}
                    className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                  >
                    {openId === item.id ? t("cancel") : t("postAsExpense")}
                  </button>
                  <button
                    onClick={() => dismiss(item.id)}
                    disabled={busy === item.id}
                    className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    {t("dismiss")}
                  </button>
                </div>
              </div>

              {openId === item.id && form && (
                <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("supplier")} *</span>
                      <input value={form.supplierName} onChange={(e) => setField("supplierName", e.target.value)} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("ico")} *</span>
                      <input value={form.supplierIco} onChange={(e) => setField("supplierIco", e.target.value)} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("dic")} *</span>
                      <input value={form.supplierDic} onChange={(e) => setField("supplierDic", e.target.value)} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("iban")} *</span>
                      <input value={form.supplierIban} onChange={(e) => setField("supplierIban", e.target.value)} className={`${inputClass} font-mono`} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("invoiceNo")} *</span>
                      <input value={form.invoiceNo} onChange={(e) => setField("invoiceNo", e.target.value)} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("invoiceDate")} *</span>
                      <input type="date" value={form.invoiceDate} onChange={(e) => setField("invoiceDate", e.target.value)} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("category")}</span>
                      <select value={form.categoryId} onChange={(e) => setField("categoryId", e.target.value)} className={inputClass}>
                        <option value="">{t("uncategorized")}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {tCat(c.slug as Parameters<typeof tCat>[0])}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("okruh")}</span>
                      <select value={form.okruh} onChange={(e) => setField("okruh", e.target.value as "fpuo" | "svc")} className={inputClass}>
                        <option value="svc">{t("okruhSvc")}</option>
                        <option value="fpuo">{t("okruhFpuo")}</option>
                      </select>
                    </label>
                    {isRevizia && (
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-700 dark:text-gray-300">{t("nextInspectionLabel")} *</span>
                        <input type="date" value={form.nextInspection} onChange={(e) => setField("nextInspection", e.target.value)} className={inputClass} />
                      </label>
                    )}
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("amountBrutto")} *</span>
                      <input value={form.amount} onChange={(e) => setField("amount", e.target.value)} inputMode="decimal" className={`${inputClass} text-right`} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("amountNetto")} *</span>
                      <input value={form.amountNetto} onChange={(e) => setField("amountNetto", e.target.value)} inputMode="decimal" className={`${inputClass} text-right`} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{t("dph")} *</span>
                      <input value={form.dph} onChange={(e) => setField("dph", e.target.value)} inputMode="decimal" className={`${inputClass} text-right`} />
                    </label>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={() => post(item.id)}
                      disabled={busy === item.id || !formValid}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                    >
                      {busy === item.id ? t("posting") : t("postSave")}
                    </button>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t("attachmentNote")}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

// Inter-okruh transfer log (BYT-20260512-002 AC 417) — METADATA ONLY.
// Records a transient cover between funds (e.g. FPÚO → služby, §10 ods. 3)
// with a "návratná pôžička" flag + a filter for open return-due entries.
// It posts NO journal entry and moves NO balance — the ledger side is
// BLOCKED (AC 416/417). The banner makes that explicit to the treasurer.

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { parseCents, formatEur } from "@modules/accounting/src/lib/money";

type Okruh = "fpuo" | "svc" | "mgmt";

interface TransferRow {
  id: string;
  fromOkruh: Okruh;
  toOkruh: Okruh;
  amountCents: number;
  transferDate: string;
  note: string | null;
  returnDueFlag: boolean;
  returnDueNote: string | null;
  returnedAt: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function OkruhTransfersPage() {
  const t = useTranslations("Accounting.transfers");
  const format = useFormatter();

  const [items, setItems] = useState<TransferRow[] | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // create form
  const [fromOkruh, setFromOkruh] = useState<Okruh>("fpuo");
  const [toOkruh, setToOkruh] = useState<Okruh>("svc");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [returnDue, setReturnDue] = useState(true);
  const [returnDueNote, setReturnDueNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/accounting/transfers${openOnly ? "?open=1" : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { items: TransferRow[] }) => setItems(d.items))
      .catch(() => setError("load"));
  }, [openOnly]);

  useEffect(load, [load]);

  const amountCents = parseCents(amount);
  const formValid =
    amountCents !== null &&
    amountCents > 0 &&
    fromOkruh !== toOkruh &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function create() {
    if (!formValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOkruh,
          toOkruh,
          amountCents,
          transferDate: new Date(`${date}T00:00:00Z`).toISOString(),
          note: note.trim() || null,
          returnDueFlag: returnDue,
          returnDueNote: returnDue ? returnDueNote.trim() || null : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setAmount("");
      setNote("");
      setReturnDueNote("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create");
    } finally {
      setSaving(false);
    }
  }

  async function act(url: string, id: string, body?: unknown) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error ?? String(res.status));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action");
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
  const okruhLabel = (o: Okruh) => t(`okruh_${o}` as "okruh_fpuo");

  return (
    <div className="max-w-4xl">
      <Link href="/accounting" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">{t("title")}</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-4">{t("subtitle")}</p>

      {/* Metadata-only disclaimer — this posts no ledger entry. */}
      <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200">
        {t("metadataBanner")}
      </div>

      {/* Create */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t("record")}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t("fromOkruh")}</span>
            <select value={fromOkruh} onChange={(e) => setFromOkruh(e.target.value as Okruh)} className={inputClass}>
              <option value="fpuo">{okruhLabel("fpuo")}</option>
              <option value="svc">{okruhLabel("svc")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t("toOkruh")}</span>
            <select value={toOkruh} onChange={(e) => setToOkruh(e.target.value as Okruh)} className={inputClass}>
              <option value="svc">{okruhLabel("svc")}</option>
              <option value="fpuo">{okruhLabel("fpuo")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t("amount")}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${inputClass} text-right`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t("date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            <span className="text-gray-700 dark:text-gray-300">{t("note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm lg:col-span-3">
            <input type="checkbox" checked={returnDue} onChange={(e) => setReturnDue(e.target.checked)} className="h-4 w-4" />
            <span className="text-gray-700 dark:text-gray-300">{t("returnDueLabel")}</span>
          </label>
          {returnDue && (
            <label className="flex flex-col gap-1 text-sm lg:col-span-3">
              <span className="text-gray-700 dark:text-gray-300">{t("returnDueNote")}</span>
              <input value={returnDueNote} onChange={(e) => setReturnDueNote(e.target.value)} className={inputClass} />
            </label>
          )}
          <div className="flex items-end">
            <button
              onClick={create}
              disabled={saving || !formValid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
        {fromOkruh === toOkruh && (
          <p className="text-amber-700 dark:text-amber-400 text-xs mt-2">{t("sameOkruhWarning")}</p>
        )}
        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">{t("actionError")} ({error})</p>
        )}
      </div>

      {/* Filter */}
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="h-4 w-4" />
        <span className="text-gray-700 dark:text-gray-300">{t("filterOpenReturnDue")}</span>
      </label>

      {/* List */}
      {items.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colDate")}</th>
                <th className="py-2 pr-4">{t("colDirection")}</th>
                <th className="py-2 pr-4 text-right">{t("colAmount")}</th>
                <th className="py-2 pr-4">{t("colStatus")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                    {format.dateTime(new Date(r.transferDate), { dateStyle: "medium" })}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {okruhLabel(r.fromOkruh)} → {okruhLabel(r.toOkruh)}
                    {r.note && <span className="block text-xs text-gray-500 dark:text-gray-400">{r.note}</span>}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">{formatEur(r.amountCents)}</td>
                  <td className="py-2 pr-4">
                    {r.returnedAt ? (
                      <span className="text-green-700 dark:text-green-400 text-xs">{t("returnedLabel")}</span>
                    ) : r.returnDueFlag ? (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                        🔁 {t("returnDueChip")}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                    )}
                    {r.returnDueFlag && r.returnDueNote && (
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.returnDueNote}</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!r.returnedAt && r.returnDueFlag && (
                      <>
                        <button
                          onClick={() => act(`/api/accounting/transfers/${r.id}/returned`, r.id)}
                          disabled={busy === r.id}
                          className="text-green-700 dark:text-green-400 hover:underline text-xs mr-3 disabled:opacity-50"
                        >
                          {t("markReturned")}
                        </button>
                        <button
                          onClick={() => act(`/api/accounting/transfers/${r.id}/return-due`, r.id, { returnDueFlag: false })}
                          disabled={busy === r.id}
                          className="text-gray-600 dark:text-gray-300 hover:underline text-xs disabled:opacity-50"
                        >
                          {t("unflag")}
                        </button>
                      </>
                    )}
                    {!r.returnedAt && !r.returnDueFlag && (
                      <button
                        onClick={() => act(`/api/accounting/transfers/${r.id}/return-due`, r.id, { returnDueFlag: true })}
                        disabled={busy === r.id}
                        className="text-amber-700 dark:text-amber-400 hover:underline text-xs disabled:opacity-50"
                      >
                        {t("flag")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

// Manual payment entry + list (BYT-20260512-002 Phase 1 slice 3).
// A recorded payment allocates automatically across the unit's open (due)
// assessments — proportional by default, FIFO across months. The result
// breakdown is shown right after saving so the treasurer sees where the
// money went; anything above the open total parks as preplatok.
// Corrections are voids with a mandatory reason — never edits.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { parseCents, formatEur } from "@modules/accounting/src/lib/money";

interface PaymentRow {
  id: string;
  receivedAt: string;
  amountCents: number;
  allocatedCents: number;
  vs: string | null;
  unitName: string | null;
  unitFlatNumber: string | null;
  narrative: string | null;
  source: "manual" | "bank_import" | "fio_api";
  voidedAt: string | null;
  voidReason: string | null;
}

interface UnitOption {
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

export default function PaymentsPage() {
  const t = useTranslations("Accounting.payments");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();

  // Pre-select a flat when arriving from its karta bytu (?unit=<id>).
  const presetUnit = useSearchParams().get("unit");

  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [unitId, setUnitId] = useState(presetUnit ?? "");
  const [method, setMethod] = useState<"bank" | "cash">("bank");
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<CreateResult | null>(null);

  // Void state
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(() => {
    fetch("/api/accounting/payments")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { payments: PaymentRow[]; units: UnitOption[] }) => {
        setRows(data.payments);
        setUnits(data.units);
        if (data.units.length > 0) {
          // Keep a ?unit= preset if it names a real unit, else first.
          const validPreset = data.units.some((u) => u.id === presetUnit);
          setUnitId((prev) => prev || (validPreset ? presetUnit! : data.units[0].id));
        }
      })
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load]);

  const amountCents = parseCents(amount);
  const today = new Date().toISOString().slice(0, 10);
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(receivedAt) && receivedAt <= today;
  const formValid =
    unitId !== "" && amountCents !== null && amountCents > 0 && dateValid;

  async function submit() {
    if (!formValid) return;
    setSubmitting(true);
    setError(null);
    setLastResult(null);
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
      setLastResult(body);
      setAmount("");
      setNote("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVoid() {
    if (!voidTarget || !voidReason.trim()) return;
    setVoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/payments/${voidTarget}/void`, {
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
      setVoiding(false);
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
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";

  return (
    <div className="max-w-4xl">
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

      {/* New payment form */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("newPayment")}
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t("unit")}</span>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={inputClass}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.flatNumber ?? u.name}
                  {u.vs ? ` (${t("vsLabel", { vs: u.vs })})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("method")}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "bank" | "cash")}
              className={inputClass}
            >
              <option value="bank">{t("methodBank")}</option>
              <option value="cash">{t("methodCash")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("amount")}
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={`${inputClass} w-32 text-right`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("receivedAt")}
            </span>
            <input
              type="date"
              value={receivedAt}
              max={today}
              onChange={(e) => setReceivedAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
            <span className="text-gray-700 dark:text-gray-300">{t("note")}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            onClick={submit}
            disabled={submitting || !formValid}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {submitting ? t("saving") : t("save")}
          </button>
        </div>

        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("submitError")} ({error})
          </p>
        )}

        {lastResult && (
          <div className="mt-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 text-sm text-green-900 dark:text-green-200">
            <p className="font-medium mb-1">
              {t("allocatedSummary", {
                allocated: formatEur(lastResult.allocatedCents),
              })}
            </p>
            {lastResult.allocations.length > 0 && (
              <ul className="space-y-0.5">
                {lastResult.allocations.map((a, i) => (
                  <li key={i}>
                    {a.periodYear}-{String(a.month).padStart(2, "0")}{" "}
                    {tCat(a.categorySlug as Parameters<typeof tCat>[0])}:{" "}
                    {formatEur(a.amountCents)}
                  </li>
                ))}
              </ul>
            )}
            {lastResult.unallocatedCents > 0 && (
              <p className="mt-1">
                {t("preplatokNote", {
                  amount: formatEur(lastResult.unallocatedCents),
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Payment list */}
      {rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colDate")}</th>
                <th className="py-2 pr-4">{t("colUnit")}</th>
                <th className="py-2 pr-4">{t("colVs")}</th>
                <th className="py-2 pr-4 text-right">{t("colAmount")}</th>
                <th className="py-2 pr-4 text-right">{t("colAllocated")}</th>
                <th className="py-2 pr-4">{t("colNote")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-gray-100 dark:border-gray-800 ${
                    p.voidedAt ? "opacity-50 line-through" : ""
                  }`}
                >
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {format.dateTime(new Date(p.receivedAt), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {p.unitFlatNumber ?? p.unitName ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {p.vs ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                    {formatEur(p.amountCents)}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-500 dark:text-gray-400">
                    {p.voidedAt ? "—" : formatEur(p.allocatedCents)}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {p.voidedAt ? (
                      <span className="no-underline">
                        {t("voidedLabel")}: {p.voidReason}
                      </span>
                    ) : (
                      p.narrative ?? ""
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!p.voidedAt && (
                      <button
                        onClick={() => {
                          setVoidTarget(p.id);
                          setVoidReason("");
                        }}
                        className="text-red-600 dark:text-red-400 hover:underline text-xs"
                      >
                        {t("void")}
                      </button>
                    )}
                  </td>
                </tr>
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
                  disabled={voiding || !voidReason.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {voiding ? t("voiding") : t("voidYes")}
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

"use client";

// Predpis editor (BYT-20260512-002 Phase 1). Draft-only editing: category
// rows with allocation key + monthly rate. A published schedule renders
// read-only — revisions supersede, never edit (domain invariant 4 family).
// Amounts entered in EUR, converted to integer cents — no float math.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  ALLOCATION_KEYS,
  type AllocationKey,
} from "@modules/accounting/src/lib/constants";
import { parseCents, centsToInput } from "@modules/accounting/src/lib/money";

interface Category {
  id: string;
  slug: string;
  okruh: string;
}

interface ServiceRow {
  serviceCategoryId: string;
  allocationKey: AllocationKey;
  /** EUR string as typed; parsed to cents on save. */
  amount: string;
}

interface ScheduleDetail {
  id: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: string;
  services: {
    serviceCategoryId: string;
    allocationKey: AllocationKey;
    rateCents: number | null;
    fixedAmountCents: number | null;
  }[];
}

export default function PredpisEditorPage({
  scheduleId,
}: {
  scheduleId: string;
}) {
  const t = useTranslations("Accounting.predpis");
  const tCat = useTranslations("Accounting.serviceCategories");
  const tKey = useTranslations("Accounting.allocationKeys");
  const router = useRouter();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/accounting/fee-schedules/${scheduleId}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(
        (data: { schedule: ScheduleDetail; categories: Category[] }) => {
          setSchedule(data.schedule);
          setCategories(data.categories);
          setRows(
            data.schedule.services.map((s) => ({
              serviceCategoryId: s.serviceCategoryId,
              allocationKey: s.allocationKey,
              amount: centsToInput(
                s.allocationKey === "fixed" ? s.fixedAmountCents : s.rateCents
              ),
            }))
          );
          setLoading(false);
        }
      )
      .catch(() => {
        setError("load");
        setLoading(false);
      });
  }, [scheduleId]);

  useEffect(load, [load]);

  const usedCategoryIds = new Set(rows.map((r) => r.serviceCategoryId));
  const availableCategories = categories.filter(
    (c) => !usedCategoryIds.has(c.id)
  );
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => {
      const cents = parseCents(r.amount);
      return cents !== null && cents > 0;
    });

  function addRow() {
    const next = availableCategories[0];
    if (!next) return;
    setRows((prev) => [
      ...prev,
      { serviceCategoryId: next.id, allocationKey: "share", amount: "" },
    ]);
  }

  function updateRow(index: number, patch: Partial<ServiceRow>) {
    setRows((prev) =>
      prev.map((r, j) => (j === index ? { ...r, ...patch } : r))
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/accounting/fee-schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          services: rows.map((r) => {
            const cents = parseCents(r.amount);
            return {
              serviceCategoryId: r.serviceCategoryId,
              allocationKey: r.allocationKey,
              rateCents: r.allocationKey === "fixed" ? null : cents,
              fixedAmountCents: r.allocationKey === "fixed" ? cents : null,
            };
          }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save");
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    setDiscarding(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/fee-schedules/${scheduleId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      router.push("/accounting/predpis");
    } catch (err) {
      setError(err instanceof Error ? err.message : "discard");
      setDiscarding(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }
  if (!schedule) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }

  const readOnly = schedule.status === "published";
  const inputClass =
    "w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-right bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60";
  const selectClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60";

  return (
    <div className="max-w-4xl">
      <Link
        href="/accounting/predpis"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToList")}
      </Link>
      <div className="flex items-center gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("editorTitle", { year: schedule.year })}
        </h1>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            readOnly
              ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
              : "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
          }`}
        >
          {t(`status.${schedule.status}`)}
        </span>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {readOnly ? t("publishedReadOnly") : t("editorSubtitle")}
      </p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        {rows.length === 0 && (
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t("noServices")}
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-4">{t("service")}</th>
                  <th className="py-2 pr-4">{t("allocationKey")}</th>
                  <th className="py-2 pr-4 text-right">{t("monthlyAmount")}</th>
                  {!readOnly && <th className="py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const cat = categoryById.get(row.serviceCategoryId);
                  return (
                    <tr
                      key={row.serviceCategoryId}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-4">
                        <select
                          value={row.serviceCategoryId}
                          disabled={readOnly}
                          onChange={(e) =>
                            updateRow(i, { serviceCategoryId: e.target.value })
                          }
                          className={selectClass}
                        >
                          {cat && (
                            <option value={cat.id}>
                              {tCat(cat.slug as Parameters<typeof tCat>[0])}
                            </option>
                          )}
                          {availableCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {tCat(c.slug as Parameters<typeof tCat>[0])}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4">
                        <select
                          value={row.allocationKey}
                          disabled={readOnly}
                          onChange={(e) =>
                            updateRow(i, {
                              allocationKey: e.target.value as AllocationKey,
                            })
                          }
                          className={selectClass}
                        >
                          {ALLOCATION_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {tKey(k)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <input
                          value={row.amount}
                          disabled={readOnly}
                          onChange={(e) =>
                            updateRow(i, { amount: e.target.value })
                          }
                          placeholder={t("amountPlaceholder")}
                          inputMode="decimal"
                          className={inputClass}
                        />
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          {row.allocationKey === "fixed"
                            ? t("perUnit")
                            : t("perDom")}
                        </span>
                      </td>
                      {!readOnly && (
                        <td className="py-2 text-right">
                          <button
                            onClick={() =>
                              setRows((prev) => prev.filter((_, j) => j !== i))
                            }
                            className="text-red-600 dark:text-red-400 hover:underline text-xs"
                          >
                            {t("removeRow")}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!readOnly && (
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={addRow}
              disabled={availableCategories.length === 0}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              + {t("addService")}
            </button>
            <div className="flex items-center gap-3">
              {saved && (
                <span className="text-sm text-green-700 dark:text-green-400">
                  {t("savedOk")}
                </span>
              )}
              <button
                onClick={save}
                disabled={saving || !rowsValid}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("submitError")} ({error})
          </p>
        )}
      </div>

      {!readOnly && (
        <div className="mt-6 border border-red-200 dark:border-red-900 rounded-lg p-4">
          {!confirmDiscard ? (
            <button
              onClick={() => setConfirmDiscard(true)}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              {t("discardDraft")}
            </button>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-700 dark:text-gray-300">
                {t("discardConfirm")}
              </span>
              <button
                onClick={discard}
                disabled={discarding}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg"
              >
                {discarding ? t("discarding") : t("discardYes")}
              </button>
              <button
                onClick={() => setConfirmDiscard(false)}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
              >
                {t("discardNo")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

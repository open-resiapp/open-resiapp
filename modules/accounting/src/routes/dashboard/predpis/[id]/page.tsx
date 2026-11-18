"use client";

// Predpis editor (BYT-20260512-002 Phase 1). Draft-only editing: category
// rows with allocation key + monthly rate. A published schedule renders
// read-only — revisions supersede, never edit (domain invariant 4 family).
// Amounts entered in EUR, converted to integer cents — no float math.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  ALLOCATION_KEYS,
  ERR_RATE_MODE_KEY,
  PER_UNIT_RATE_KEYS,
  type AllocationKey,
  type RateMode,
} from "@modules/accounting/src/lib/constants";
import {
  parseCents,
  centsToInput,
  formatEur,
} from "@modules/accounting/src/lib/money";

interface Category {
  id: string;
  slug: string;
  okruh: string;
}

interface ServiceRow {
  serviceCategoryId: string;
  allocationKey: AllocationKey;
  /** Non-fixed keys: dom total ("total") or €/m², €/person ("per_unit"). */
  rateMode: RateMode;
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
    rateMode: RateMode;
    fixedAmountCents: number | null;
    /** Published only: stored dom-wide total of the first month. */
    monthlyTotalCents: number | null;
  }[];
}

interface Preview {
  year: number;
  months: number[];
  categoryOrder: string[];
  monthTotals: { month: number; totalCents: number }[];
  units: {
    unitEntityId: string;
    name: string;
    flatNumber: string | null;
    vs: string;
    perService: Record<string, number>;
    totalCents: number;
  }[];
  serviceTotals: Record<string, number>;
  monthlyTotalCents: number;
}

export default function PredpisEditorPage({
  scheduleId,
}: {
  scheduleId: string;
}) {
  const t = useTranslations("Accounting.predpis");
  const tCat = useTranslations("Accounting.serviceCategories");
  const tKey = useTranslations("Accounting.allocationKeys");
  const format = useFormatter();
  const router = useRouter();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [effectiveMonth, setEffectiveMonth] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // True whenever the on-screen rows differ from what the server has —
  // preview/publish always operate on SAVED state, so they are gated on
  // !dirty to prevent confirming amounts that differ from the screen.
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewSlugs, setPreviewSlugs] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
              rateMode: s.rateMode,
              amount: centsToInput(
                s.allocationKey === "fixed" ? s.fixedAmountCents : s.rateCents
              ),
            }))
          );
          setEffectiveMonth(
            new Date(data.schedule.effectiveFrom).getUTCMonth() + 1
          );
          setDirty(false);
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

  // per_unit only makes sense for keys with a unit measure (m², persons);
  // switching the key away falls back to the dom-total reading.
  function rowRateMode(r: ServiceRow): RateMode {
    return r.rateMode === "per_unit" &&
      PER_UNIT_RATE_KEYS.includes(r.allocationKey)
      ? "per_unit"
      : "total";
  }

  function unitSuffix(r: ServiceRow): string {
    if (r.allocationKey === "fixed") return t("perUnit");
    if (rowRateMode(r) === "per_unit") {
      return r.allocationKey === "area_m2" ? t("perM2") : t("perPerson");
    }
    return t("perDom");
  }

  /** Stable error codes from the server → catalog; raw text otherwise. */
  function errorText(code: string): string {
    return code === ERR_RATE_MODE_KEY ? t("rateModeKeyUnsupported") : code;
  }

  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => {
      const cents = parseCents(r.amount);
      return cents !== null && cents > 0;
    });

  // Any edit invalidates the loaded preview and the publish confirmation —
  // they reflect saved state, not the screen.
  function markDirty() {
    setDirty(true);
    setSaved(false);
    setPreview(null);
    setConfirmPublish(false);
  }

  function addRow() {
    const next = availableCategories[0];
    if (!next) return;
    setRows((prev) => [
      ...prev,
      {
        serviceCategoryId: next.id,
        allocationKey: "share",
        rateMode: "total",
        amount: "",
      },
    ]);
    markDirty();
  }

  function updateRow(index: number, patch: Partial<ServiceRow>) {
    setRows((prev) =>
      prev.map((r, j) => (j === index ? { ...r, ...patch } : r))
    );
    markDirty();
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, j) => j !== index));
    markDirty();
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
          effectiveFrom: new Date(
            Date.UTC(schedule!.year, effectiveMonth - 1, 1)
          ).toISOString(),
          services: rows.map((r) => {
            const cents = parseCents(r.amount);
            return {
              serviceCategoryId: r.serviceCategoryId,
              allocationKey: r.allocationKey,
              rateCents: r.allocationKey === "fixed" ? null : cents,
              rateMode: rowRateMode(r),
              fixedAmountCents: r.allocationKey === "fixed" ? cents : null,
            };
          }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSaved(true);
      setDirty(false);
      setPreview(null);
      setConfirmPublish(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save");
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/accounting/fee-schedules/${scheduleId}/preview`
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setPreview(body.preview);
      setPreviewSlugs(body.slugs);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setPreviewError(null);
    try {
      const res = await fetch(
        `/api/accounting/fee-schedules/${scheduleId}/publish`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setPreview(null);
      setConfirmPublish(false);
      setLoading(true);
      load();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "publish");
    } finally {
      setPublishing(false);
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
        className="text-base text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToList")}
      </Link>
      <div className="flex items-center gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("editorTitle", { year: schedule.year })}
        </h1>
        <span
          className={`text-base px-3 py-1 rounded-full ${
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

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
        <label className="flex flex-wrap items-center gap-3 mb-4 text-base">
          <span className="text-gray-700 dark:text-gray-300">
            {t("effectiveFromLabel")}
          </span>
          <select
            value={effectiveMonth}
            disabled={readOnly}
            onChange={(e) => {
              setEffectiveMonth(Number(e.target.value));
              markDirty();
            }}
            className={selectClass}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {format.dateTime(new Date(Date.UTC(schedule.year, m - 1, 1)), {
                  month: "long",
                })}{" "}
                {schedule.year}
              </option>
            ))}
          </select>
        </label>

        {rows.length === 0 && (
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t("noServices")}
          </p>
        )}
        {rows.length > 0 && (
          // Stacked rows (no table): three controls per service wrap
          // cleanly at 390 px instead of forcing a horizontal scroll.
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-700">
            {rows.map((row, i) => {
              const cat = categoryById.get(row.serviceCategoryId);
              const mode = rowRateMode(row);
              const perUnitAllowed = PER_UNIT_RATE_KEYS.includes(
                row.allocationKey
              );
              // Dom-wide monthly total: stored (published) or computed by
              // the on-demand preview (draft, saved state only).
              const domTotal = readOnly
                ? schedule.services.find(
                    (s) => s.serviceCategoryId === row.serviceCategoryId
                  )?.monthlyTotalCents ?? null
                : preview?.serviceTotals[row.serviceCategoryId] ?? null;
              return (
                <li key={row.serviceCategoryId} className="py-4 space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 min-w-0 flex-1 basis-56">
                      <span className="text-base text-gray-600 dark:text-gray-400">
                        {t("service")}
                      </span>
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
                    </label>
                    <label className="flex flex-col gap-1 min-w-0 flex-1 basis-56">
                      <span className="text-base text-gray-600 dark:text-gray-400">
                        {t("allocationKey")}
                      </span>
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
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-base text-gray-600 dark:text-gray-400">
                        {mode === "per_unit" ? t("rateLabel") : t("monthlyAmount")}
                      </span>
                      <span className="flex items-center gap-2">
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
                        <span className="text-base text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {unitSuffix(row)}
                        </span>
                      </span>
                    </label>
                  </div>

                  {perUnitAllowed && (
                    // Explicit per-state buttons (project rule: no toggle
                    // cycling values) — what the typed amount means.
                    <div
                      role="radiogroup"
                      aria-label={t("rateModeLabel")}
                      className="flex flex-wrap gap-2"
                    >
                      {(["total", "per_unit"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={mode === m}
                          disabled={readOnly}
                          onClick={() => updateRow(i, { rateMode: m })}
                          className={`min-h-11 px-4 py-2 rounded-lg border text-base disabled:opacity-60 ${
                            mode === m
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200"
                          }`}
                        >
                          {m === "total"
                            ? t("rateModeTotal")
                            : row.allocationKey === "area_m2"
                              ? t("rateModePerM2")
                              : t("rateModePerPerson")}
                        </button>
                      ))}
                    </div>
                  )}

                  {row.allocationKey !== "fixed" && (
                    <p className="text-base text-gray-700 dark:text-gray-300">
                      {domTotal !== null
                        ? t("domTotalLine", { amount: formatEur(domTotal) })
                        : mode === "per_unit"
                          ? t("domTotalInPreview")
                          : null}
                    </p>
                  )}

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="min-h-11 text-base text-red-600 dark:text-red-400 hover:underline"
                    >
                      {t("removeRow")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!readOnly && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={addRow}
              disabled={availableCategories.length === 0}
              className="text-base text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              + {t("addService")}
            </button>
            <div className="flex items-center gap-3">
              {saved && (
                <span className="text-base text-green-700 dark:text-green-400">
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
          <p className="text-red-600 dark:text-red-400 text-base mt-3">
            {t("submitError")} ({errorText(error)})
          </p>
        )}
      </div>

      {!readOnly && (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("previewTitle")}
            </h2>
            <button
              onClick={loadPreview}
              disabled={
                previewLoading ||
                dirty ||
                (schedule.services.length === 0 && !saved)
              }
              className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg disabled:opacity-50 text-base"
            >
              {previewLoading ? t("previewLoading") : t("loadPreview")}
            </button>
          </div>
          <p className="text-base text-gray-600 dark:text-gray-400 mt-2">
            {t("previewHint")}
          </p>

          {previewError && (
            <p className="text-red-600 dark:text-red-400 text-base mt-3">
              {t("submitError")} ({errorText(previewError)})
            </p>
          )}

          {preview && (
            <>
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-base">
                  <thead>
                    <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-2 pr-4">{t("unitCol")}</th>
                      <th className="py-2 pr-4">{t("vsCol")}</th>
                      {preview.categoryOrder.map((catId) => (
                        <th key={catId} className="py-2 pr-4 text-right">
                          {previewSlugs[catId]
                            ? tCat(
                                previewSlugs[catId] as Parameters<
                                  typeof tCat
                                >[0]
                              )
                            : catId}
                        </th>
                      ))}
                      <th className="py-2 text-right">{t("totalCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.units.map((u) => (
                      <tr
                        key={u.unitEntityId}
                        className="border-b border-gray-100 dark:border-gray-800"
                      >
                        <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                          {u.flatNumber ?? u.name}
                        </td>
                        <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                          {u.vs}
                        </td>
                        {preview.categoryOrder.map((catId) => (
                          <td key={catId} className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                            {formatEur(u.perService[catId] ?? 0)}
                          </td>
                        ))}
                        <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                          {formatEur(u.totalCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold text-gray-900 dark:text-gray-100">
                      <td className="py-2 pr-4">{t("monthlyTotal")}</td>
                      <td />
                      {preview.categoryOrder.map((catId) => (
                        <td key={catId} className="py-2 pr-4 text-right">
                          {formatEur(preview.serviceTotals[catId] ?? 0)}
                        </td>
                      ))}
                      <td className="py-2 text-right">
                        {formatEur(preview.monthlyTotalCents)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {preview.monthTotals.some(
                (m) => m.totalCents !== preview.monthlyTotalCents
              ) && (
                <div className="mt-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-base text-amber-900 dark:text-amber-200">
                  <p className="mb-2">{t("amountsVaryNote")}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {preview.monthTotals.map((m) => (
                      <span key={m.month}>
                        {format.dateTime(
                          new Date(Date.UTC(preview.year, m.month - 1, 1)),
                          { month: "short" }
                        )}
                        : {formatEur(m.totalCents)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-base">
                <label className="flex items-start gap-2 text-blue-900 dark:text-blue-200">
                  <input
                    type="checkbox"
                    checked={confirmPublish}
                    onChange={(e) => setConfirmPublish(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    {t("publishConfirm", {
                      months: preview.months.length,
                      year: preview.year,
                    })}
                  </span>
                </label>
                <div className="flex justify-end mt-3">
                  <button
                    onClick={publish}
                    disabled={publishing || !confirmPublish}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    {publishing ? t("publishing") : t("publish")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="mt-6 border border-red-200 dark:border-red-900 rounded-lg p-4">
          {!confirmDiscard ? (
            <button
              onClick={() => setConfirmDiscard(true)}
              className="text-base text-red-600 dark:text-red-400 hover:underline"
            >
              {t("discardDraft")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-base">
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

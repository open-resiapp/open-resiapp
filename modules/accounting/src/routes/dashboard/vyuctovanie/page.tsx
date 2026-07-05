"use client";

// Ročné vyúčtovanie wizard — preview stage (BYT-20260512-002 Phase 4).
// Gates first (spec: can't proceed with unreconciled bank lines or
// uncategorized invoices), then the per-unit settlement table. Publish
// (PDF + delivery + period lock) arrives in the next slice — the preview
// carries an explicit draft banner until then.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface Gates {
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  unmatchedBankLines: number;
  uncategorizedExpenses: number;
  unitsWithoutReadings: number;
  yearElapsed: boolean;
  draftSchedules: number;
  canPublish: boolean;
}

interface ServiceLine {
  serviceCategoryId: string;
  prescribedCents: number;
  advancesCents: number;
  costShareCents: number;
  differenceCents: number;
}

interface UnitSettlement {
  unitEntityId: string;
  services: ServiceLine[];
  totalCostCents: number;
  totalAdvancesCents: number;
  totalDifferenceCents: number;
}

interface Preview {
  year: number;
  gates: Gates;
  unprescribedCostCategories: string[];
  settlement: {
    units: UnitSettlement[];
    perService: {
      serviceCategoryId: string;
      actualCostCents: number;
      prescribedCents: number;
      advancesCents: number;
    }[];
    totalDifferenceCents: number;
  } | null;
  categorySlugs: Record<string, string>;
  unitLabels: Record<string, string>;
}

export default function VyuctovaniePage() {
  const t = useTranslations("Accounting.vyuctovanie");
  const tCat = useTranslations("Accounting.serviceCategories");

  const [year, setYear] = useState(() => new Date().getUTCFullYear() - 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(() => {
    setPreview(null);
    fetch(`/api/accounting/vyuctovanie?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Preview) => setPreview(data))
      .catch(() => setError(true));
  }, [year]);

  useEffect(load, [load]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/accounting/vyuctovanie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setConfirmPublish(false);
      load();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "publish");
    } finally {
      setPublishing(false);
    }
  }

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }

  const gateItem = (
    ok: boolean,
    label: string,
    link?: { href: string; text: string }
  ) => (
    <li className="flex items-center gap-2 text-sm">
      <span>{ok ? "✅" : "❌"}</span>
      <span className="text-gray-900 dark:text-gray-100">{label}</span>
      {!ok && link && (
        <Link
          href={link.href}
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {link.text}
        </Link>
      )}
    </li>
  );

  return (
    <div className="max-w-5xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <div className="flex items-center gap-4 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
        >
          {/* Only ELAPSED years — a mid-year settlement would charge 12
              months of prescriptions against a partial year. */}
          {Array.from({ length: 4 }, (_, i) => {
            const y = new Date().getUTCFullYear() - 1 - i;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </select>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {!preview ? (
        <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
      ) : (
        <>
          {/* Gates */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t("gatesTitle")}
            </h2>
            <ul className="space-y-2">
              {gateItem(
                preview.gates.unmatchedBankLines === 0,
                t("gateUnmatched", {
                  count: preview.gates.unmatchedBankLines,
                }),
                { href: "/accounting/reconciliation", text: t("resolve") }
              )}
              {gateItem(
                preview.gates.uncategorizedExpenses === 0,
                t("gateUncategorized", {
                  count: preview.gates.uncategorizedExpenses,
                }),
                { href: "/accounting/expenses", text: t("resolve") }
              )}
              <li className="flex items-center gap-2 text-sm">
                <span>
                  {preview.gates.unitsWithoutReadings === 0 ? "✅" : "⚠️"}
                </span>
                <span className="text-gray-900 dark:text-gray-100">
                  {t("gateReadings", {
                    count: preview.gates.unitsWithoutReadings,
                  })}
                </span>
                {preview.gates.unitsWithoutReadings > 0 && (
                  <Link
                    href="/accounting/meters"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {t("resolve")}
                  </Link>
                )}
              </li>
            </ul>
            {preview.gates.periodStatus === "published" && (
              <p className="mt-3 text-sm text-green-700 dark:text-green-400">
                {t("alreadyPublished")}
              </p>
            )}
            {preview.unprescribedCostCategories.length > 0 && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                {t("unprescribedWarning", {
                  categories: preview.unprescribedCostCategories.join(", "),
                })}
              </p>
            )}
            {preview.gates.draftSchedules > 0 && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                {t("draftScheduleWarning", {
                  count: preview.gates.draftSchedules,
                })}
              </p>
            )}
          </div>

          {/* Settlement preview */}
          {preview.settlement === null ? (
            <p className="text-gray-600 dark:text-gray-400">
              {t("blockedHint")}
            </p>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
              <div className="mb-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
                {t("draftBanner")}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-4">{t("colUnit")}</th>
                    {preview.settlement.perService.map((s) => (
                      <th
                        key={s.serviceCategoryId}
                        className="py-2 pr-4 text-right"
                      >
                        {preview.categorySlugs[s.serviceCategoryId]
                          ? tCat(
                              preview.categorySlugs[
                                s.serviceCategoryId
                              ] as Parameters<typeof tCat>[0]
                            )
                          : s.serviceCategoryId}
                      </th>
                    ))}
                    <th className="py-2 text-right">{t("colTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.settlement.units.map((u) => (
                    <tr
                      key={u.unitEntityId}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {preview.unitLabels[u.unitEntityId] ?? u.unitEntityId}
                      </td>
                      {u.services.map((s) => (
                        <td
                          key={s.serviceCategoryId}
                          className={`py-2 pr-4 text-right ${
                            s.differenceCents > 0
                              ? "text-red-600 dark:text-red-400"
                              : s.differenceCents < 0
                                ? "text-green-700 dark:text-green-400"
                                : "text-gray-500 dark:text-gray-400"
                          }`}
                          title={t("cellTitle", {
                            cost: formatEur(s.costShareCents),
                            advances: formatEur(s.advancesCents),
                          })}
                        >
                          {formatEur(s.differenceCents)}
                        </td>
                      ))}
                      <td
                        className={`py-2 text-right font-medium ${
                          u.totalDifferenceCents > 0
                            ? "text-red-600 dark:text-red-400"
                            : u.totalDifferenceCents < 0
                              ? "text-green-700 dark:text-green-400"
                              : "text-gray-900 dark:text-gray-100"
                        }`}
                      >
                        {formatEur(u.totalDifferenceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-gray-900 dark:text-gray-100">
                    <td className="py-2 pr-4">{t("footTotals")}</td>
                    {preview.settlement.perService.map((s) => (
                      <td
                        key={s.serviceCategoryId}
                        className="py-2 pr-4 text-right"
                        title={t("footTitle", {
                          cost: formatEur(s.actualCostCents),
                          advances: formatEur(s.advancesCents),
                        })}
                      >
                        {formatEur(s.actualCostCents - s.advancesCents)}
                      </td>
                    ))}
                    <td className="py-2 text-right">
                      {formatEur(preview.settlement.totalDifferenceCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                {t("signHint")}
              </p>

              {/* Publish */}
              {preview.gates.canPublish &&
                preview.unprescribedCostCategories.length === 0 && (
                <div className="mt-6 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm">
                  <label className="flex items-start gap-2 text-blue-900 dark:text-blue-200">
                    <input
                      type="checkbox"
                      checked={confirmPublish}
                      onChange={(e) => setConfirmPublish(e.target.checked)}
                      className="mt-1"
                    />
                    <span>{t("publishConfirm", { year: preview.year })}</span>
                  </label>
                  {publishError && (
                    <p className="text-red-600 dark:text-red-400 mt-2">
                      {t("publishError")} ({publishError})
                    </p>
                  )}
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
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

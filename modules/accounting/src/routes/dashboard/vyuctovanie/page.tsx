"use client";

// Ročné vyúčtovanie wizard — gates, preview, publish (BYT-20260512-002
// Phase 4). Fix wave 2026-11-18: the result is náklady − PREDPÍSANÉ zálohy
// (what the ledger books); unpaid advances are a separate "z toho
// neuhradené" column, never part of the result. Every publish blocker
// arrives as a stable code (gates.blockers) with details, mapped to i18n
// here. Layout: unit cards on phones, a table from sm up — min 16px text.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface Gates {
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  unmatchedBankLines: number;
  uncategorizedExpenses: number;
  unitsWithoutReadings: number;
  readingRound?: {
    hasRound: boolean;
    missingUnits: number;
    unresolvedUnits: number;
    singleReadingUnits: number;
  };
  yearElapsed: boolean;
  draftSchedules: number;
  meteredSingleReadingUnits?: number;
  blockers?: string[];
  canPublish: boolean;
}

interface ServiceLine {
  serviceCategoryId: string;
  prescribedCents: number;
  advancesCents: number;
  unpaidCents: number;
  costShareCents: number;
  differenceCents: number;
  allocationKey: string | null;
}

interface UnitSettlement {
  unitEntityId: string;
  services: ServiceLine[];
  totalCostCents: number;
  totalPrescribedCents: number;
  totalAdvancesCents: number;
  totalUnpaidCents: number;
  totalDifferenceCents: number;
}

interface BlockerDetails {
  meterReadingsMissing: { categoryId: string; unitIds: string[] }[];
  meterAreaMissing: { categoryId: string; unitIds: string[] }[];
  splitKey: { categoryId: string; key: string; code: string }[];
  negativeCostCategoryIds: string[];
  ledgerViolations: {
    code: string;
    ref: string | null;
    expectedCents: number;
    actualCents: number;
  }[];
}

interface Preview {
  year: number;
  gates: Gates;
  blockerDetails?: BlockerDetails;
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

const resultClass = (cents: number) =>
  cents > 0
    ? "text-red-700 dark:text-red-400"
    : cents < 0
      ? "text-green-700 dark:text-green-400"
      : "text-gray-900 dark:text-gray-100";

export default function VyuctovaniePage() {
  const t = useTranslations("Accounting.vyuctovanie");
  const tCat = useTranslations("Accounting.serviceCategories");
  const tKey = useTranslations("Accounting.vyuctovaniePdf");
  const tRounds = useTranslations("ReadingRounds.gate");
  const router = useRouter();

  const [year, setYear] = useState(() => new Date().getUTCFullYear() - 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  // 403 = plain owner: board-wide preview is not for them.
  const [forbidden, setForbidden] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(() => {
    setPreview(null);
    fetch(`/api/accounting/vyuctovanie?year=${year}`)
      .then((r) => {
        if (r.status === 403) {
          // Plain owner: their own settlement lives on Moje platby.
          setForbidden(true);
          router.replace("/moje-platby");
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Preview | null) => {
        if (data) setPreview(data);
      })
      .catch(() => setError(true));
  }, [year, router]);

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
      // The API returns a localized message for every known code.
      if (!res.ok) throw new Error(body?.error ?? t("publishError"));
      setConfirmPublish(false);
      load();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : t("publishError"));
    } finally {
      setPublishing(false);
    }
  }

  if (forbidden) return null;

  if (error) {
    return <p className="text-base text-red-700 dark:text-red-400">{t("loadError")}</p>;
  }

  const catName = (id: string) =>
    preview?.categorySlugs[id]
      ? tCat(preview.categorySlugs[id] as Parameters<typeof tCat>[0])
      : id;
  const unitName = (id: string) => preview?.unitLabels[id] ?? id;
  const keyName = (key: string | null) =>
    key ? tKey(`allocationKey_${key}` as Parameters<typeof tKey>[0]) : "—";

  const gateItem = (
    ok: boolean,
    label: string,
    link?: { href: string; text: string }
  ) => (
    <li className="flex flex-wrap items-start gap-2 text-base">
      <span aria-hidden>{ok ? "✅" : "❌"}</span>
      <span className="flex-1 min-w-0 text-gray-900 dark:text-gray-100">{label}</span>
      {!ok && link && (
        <Link
          href={link.href}
          className="text-blue-700 dark:text-blue-400 hover:underline"
        >
          {link.text}
        </Link>
      )}
    </li>
  );

  const blockerLine = (code: string): string => {
    const d = preview?.blockerDetails;
    switch (code) {
      case "METER_READINGS_MISSING":
        return (d?.meterReadingsMissing ?? [])
          .map((m) =>
            t("blockers.METER_READINGS_MISSING", {
              service: catName(m.categoryId),
              units: m.unitIds.map(unitName).join(", "),
            })
          )
          .join(" ");
      case "METER_AREA_MISSING":
        return (d?.meterAreaMissing ?? [])
          .map((m) =>
            t("blockers.METER_AREA_MISSING", {
              service: catName(m.categoryId),
              units: m.unitIds.map(unitName).join(", "),
            })
          )
          .join(" ");
      case "SPLIT_KEY_NO_DATA":
      case "SPLIT_KEY_NO_WEIGHT":
      case "PERSON_MONTHS_UNRESOLVED":
        return (d?.splitKey ?? [])
          .filter((s) => s.code === code)
          .map((s) =>
            t(`blockers.${code}` as Parameters<typeof t>[0], {
              service: catName(s.categoryId),
              key: keyName(s.key),
            })
          )
          .join(" ");
      case "LEDGER_COST_NEGATIVE":
        return t("blockers.LEDGER_COST_NEGATIVE", {
          services: (d?.negativeCostCategoryIds ?? []).map(catName).join(", "),
        });
      case "LEDGER_MISMATCH":
        return [
          t("blockers.LEDGER_MISMATCH"),
          ...(d?.ledgerViolations ?? []).map((v) =>
            t(`ledgerViolation.${v.code}` as Parameters<typeof t>[0], {
              ref: v.ref
                ? preview?.categorySlugs[v.ref]
                  ? catName(v.ref)
                  : unitName(v.ref)
                : "—",
              expected: formatEur(v.expectedCents),
              actual: formatEur(v.actualCents),
            })
          ),
        ].join(" ");
      case "METER_SINGLE_READING":
        return t("gateSingleReadingBlocking", {
          count: preview?.gates.meteredSingleReadingUnits ?? 0,
        });
      default:
        return t(`blockers.${code}` as Parameters<typeof t>[0]);
    }
  };

  const s = preview?.settlement ?? null;
  const domCost = s ? s.units.reduce((a, u) => a + u.totalCostCents, 0) : 0;
  const domPrescribed = s ? s.units.reduce((a, u) => a + u.totalPrescribedCents, 0) : 0;
  const domUnpaid = s ? s.units.reduce((a, u) => a + u.totalUnpaidCents, 0) : 0;
  const ledgerOk =
    preview !== null && !(preview.gates.blockers ?? []).includes("LEDGER_MISMATCH");

  return (
    <div className="max-w-5xl">
      <Link
        href="/accounting"
        className="text-base text-blue-700 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <div className="flex flex-wrap items-center gap-4 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label={t("yearLabel")}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base"
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
      <p className="text-base text-gray-700 dark:text-gray-300 mb-6">{t("subtitle")}</p>

      {!preview ? (
        <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
      ) : (
        <>
          {/* Gates */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-5 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t("gatesTitle")}
            </h2>
            <ul className="space-y-2">
              {gateItem(
                preview.gates.unmatchedBankLines === 0,
                t("gateUnmatched", {
                  count: preview.gates.unmatchedBankLines,
                }),
                { href: "/accounting/payments?tab=bank", text: t("resolve") }
              )}
              {gateItem(
                preview.gates.uncategorizedExpenses === 0,
                t("gateUncategorized", {
                  count: preview.gates.uncategorizedExpenses,
                }),
                { href: "/accounting/expenses", text: t("resolve") }
              )}
              <li className="flex flex-wrap items-start gap-2 text-base">
                <span aria-hidden>
                  {preview.gates.unitsWithoutReadings === 0 ? "✅" : "⚠️"}
                </span>
                <span className="flex-1 min-w-0 text-gray-900 dark:text-gray-100">
                  {t("gateReadings", {
                    count: preview.gates.unitsWithoutReadings,
                  })}
                </span>
                {preview.gates.unitsWithoutReadings > 0 && (
                  <Link
                    href={`/accounting/readings?year=${preview.year}`}
                    className="text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {t("resolve")}
                  </Link>
                )}
              </li>
              {/* Reading round hand-off (BYT-20261118-006) — informational. */}
              {preview.gates.readingRound?.hasRound && (
                <li className="flex flex-wrap items-start gap-2 text-base">
                  <span aria-hidden>
                    {preview.gates.readingRound.missingUnits === 0 &&
                    preview.gates.readingRound.unresolvedUnits === 0
                      ? "✅"
                      : "⚠️"}
                  </span>
                  <span className="flex-1 min-w-0 text-gray-900 dark:text-gray-100">
                    {tRounds("round", {
                      missing: preview.gates.readingRound.missingUnits,
                      unresolved: preview.gates.readingRound.unresolvedUnits,
                    })}
                  </span>
                  <Link
                    href={`/accounting/readings?year=${preview.year}`}
                    className="text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {t("resolve")}
                  </Link>
                </li>
              )}
              {/* Blocking codes with their details. */}
              {(preview.gates.blockers ?? []).map((code) => (
                <li key={code} className="flex flex-wrap items-start gap-2 text-base">
                  <span aria-hidden>❌</span>
                  <span className="flex-1 min-w-0 text-gray-900 dark:text-gray-100">
                    {blockerLine(code)}
                  </span>
                  {code.startsWith("METER_") || code === "PERSON_MONTHS_UNRESOLVED" ? (
                    <Link
                      href={`/accounting/readings?year=${preview.year}`}
                      className="text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      {t("resolve")}
                    </Link>
                  ) : code.startsWith("LEDGER_") ? (
                    <Link
                      href="/accounting/journal"
                      className="text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      {t("resolve")}
                    </Link>
                  ) : null}
                </li>
              ))}
              {(preview.gates.blockers ?? []).length === 0 &&
                (preview.gates.readingRound?.singleReadingUnits ?? 0) > 0 && (
                <li className="flex flex-wrap items-start gap-2 text-base">
                  <span aria-hidden>⚠️</span>
                  <span className="flex-1 min-w-0 text-gray-900 dark:text-gray-100">
                    {tRounds("singleReading", {
                      count: preview.gates.readingRound!.singleReadingUnits,
                    })}
                  </span>
                </li>
              )}
            </ul>
            {preview.gates.periodStatus === "published" && (
              <p className="mt-3 text-base text-green-700 dark:text-green-400">
                {t("alreadyPublished")}
              </p>
            )}
            {preview.unprescribedCostCategories.length > 0 && (
              <p className="mt-3 text-base text-red-700 dark:text-red-400">
                {t("unprescribedWarning", {
                  categories: preview.unprescribedCostCategories
                    .map((slug) => tCat(slug as Parameters<typeof tCat>[0]))
                    .join(", "),
                })}
              </p>
            )}
            {preview.gates.draftSchedules > 0 && (
              <p className="mt-3 text-base text-amber-800 dark:text-amber-400">
                {t("draftScheduleWarning", {
                  count: preview.gates.draftSchedules,
                })}
              </p>
            )}
          </div>

          {/* Settlement preview */}
          {s === null ? (
            <p className="text-base text-gray-700 dark:text-gray-300">
              {t("blockedHint")}
            </p>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
              <div className="mb-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 text-base text-amber-900 dark:text-amber-200">
                {t("draftBanner")}
              </div>
              <p className="mb-4 text-base text-gray-700 dark:text-gray-300">
                {t("basisHint")}
              </p>

              {/* Phones: one card per unit. */}
              <ul className="sm:hidden space-y-3">
                {s.units.map((u) => (
                  <li
                    key={u.unitEntityId}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-base"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {unitName(u.unitEntityId)}
                      </span>
                      <span className={`font-semibold ${resultClass(u.totalDifferenceCents)}`}>
                        {formatEur(u.totalDifferenceCents)}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-gray-800 dark:text-gray-200">
                      <dt>{t("colCost")}</dt>
                      <dd className="text-right">{formatEur(u.totalCostCents)}</dd>
                      <dt>{t("colPrescribed")}</dt>
                      <dd className="text-right">{formatEur(u.totalPrescribedCents)}</dd>
                      <dt>{t("colUnpaid")}</dt>
                      <dd className="text-right">{formatEur(u.totalUnpaidCents)}</dd>
                    </dl>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
                        {t("byService")}
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {u.services.map((l) => (
                          <li key={l.serviceCategoryId}>
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {catName(l.serviceCategoryId)} ({keyName(l.allocationKey)})
                            </div>
                            <div className="text-gray-700 dark:text-gray-300">
                              {t("serviceLine", {
                                cost: formatEur(l.costShareCents),
                                prescribed: formatEur(l.prescribedCents),
                                result: formatEur(l.differenceCents),
                              })}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
                <li className="border-t-2 border-gray-300 dark:border-gray-600 pt-3 text-base">
                  <div className="flex items-baseline justify-between gap-2 font-semibold text-gray-900 dark:text-gray-100">
                    <span>{t("footTotals")}</span>
                    <span className={resultClass(s.totalDifferenceCents)}>
                      {formatEur(s.totalDifferenceCents)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-gray-800 dark:text-gray-200">
                    <dt>{t("colCost")}</dt>
                    <dd className="text-right">{formatEur(domCost)}</dd>
                    <dt>{t("colPrescribed")}</dt>
                    <dd className="text-right">{formatEur(domPrescribed)}</dd>
                    <dt>{t("colUnpaid")}</dt>
                    <dd className="text-right">{formatEur(domUnpaid)}</dd>
                  </dl>
                </li>
              </ul>

              {/* sm+: unit table. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="text-left text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-2 pr-4">{t("colUnit")}</th>
                      <th className="py-2 pr-4 text-right">{t("colCost")}</th>
                      <th className="py-2 pr-4 text-right">{t("colPrescribed")}</th>
                      <th className="py-2 pr-4 text-right">{t("colUnpaid")}</th>
                      <th className="py-2 text-right">{t("colResult")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.units.map((u) => (
                      <tr
                        key={u.unitEntityId}
                        className="border-b border-gray-100 dark:border-gray-800"
                      >
                        <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                          {unitName(u.unitEntityId)}
                        </td>
                        <td className="py-2 pr-4 text-right whitespace-nowrap">
                          {formatEur(u.totalCostCents)}
                        </td>
                        <td className="py-2 pr-4 text-right whitespace-nowrap">
                          {formatEur(u.totalPrescribedCents)}
                        </td>
                        <td className="py-2 pr-4 text-right whitespace-nowrap">
                          {formatEur(u.totalUnpaidCents)}
                        </td>
                        <td
                          className={`py-2 text-right whitespace-nowrap font-medium ${resultClass(u.totalDifferenceCents)}`}
                        >
                          {formatEur(u.totalDifferenceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold text-gray-900 dark:text-gray-100">
                      <td className="py-2 pr-4">{t("footTotals")}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{formatEur(domCost)}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{formatEur(domPrescribed)}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{formatEur(domUnpaid)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {formatEur(s.totalDifferenceCents)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Per service: cost, key, prescription, result. */}
              <h3 className="mt-6 mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("byService")}
              </h3>
              <ul className="space-y-2 text-base">
                {s.perService.map((p) => {
                  const key =
                    s.units[0]?.services.find(
                      (l) => l.serviceCategoryId === p.serviceCategoryId
                    )?.allocationKey ?? null;
                  return (
                    <li
                      key={p.serviceCategoryId}
                      className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-gray-100 dark:border-gray-800 pb-2"
                    >
                      <span className="text-gray-900 dark:text-gray-100">
                        {catName(p.serviceCategoryId)} ({keyName(key)})
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        {t("serviceLine", {
                          cost: formatEur(p.actualCostCents),
                          prescribed: formatEur(p.prescribedCents),
                          result: formatEur(p.actualCostCents - p.prescribedCents),
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="text-base text-gray-700 dark:text-gray-300 mt-4">
                {t("signHint")}
              </p>
              <p
                className={`text-base mt-2 ${ledgerOk ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
              >
                {ledgerOk ? t("ledgerOk") : t("blockers.LEDGER_MISMATCH")}
              </p>

              {/* Publish */}
              {preview.gates.canPublish &&
                preview.unprescribedCostCategories.length === 0 && (
                <div className="mt-6 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-base">
                  <label className="flex items-start gap-2 text-blue-900 dark:text-blue-200">
                    <input
                      type="checkbox"
                      checked={confirmPublish}
                      onChange={(e) => setConfirmPublish(e.target.checked)}
                      className="mt-1 h-5 w-5"
                    />
                    <span>{t("publishConfirm", { year: preview.year })}</span>
                  </label>
                  {publishError && (
                    <p className="text-red-700 dark:text-red-400 mt-2">
                      {publishError}
                    </p>
                  )}
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={publish}
                      disabled={publishing || !confirmPublish}
                      className="min-h-11 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
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

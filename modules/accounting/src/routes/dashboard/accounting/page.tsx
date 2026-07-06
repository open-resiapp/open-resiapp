"use client";

// Accounting landing page (BYT-20260512-002 Phase 1 slice 5).
// Board roles: 4 tiles (Pokladnica, Banka, Fond opráv, Nedoplatky) +
// navigation cards; onboarding CTA until the opening balance is posted.
// Owners (403 from the dashboard API): fall back to their own karta bytu.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface ProjectionMonth {
  month: number;
  year: number;
  expectedInflowCents: number;
  expenseCents: number;
  closingCents: number;
  estimated: boolean;
}

interface Projection {
  openingCents: number;
  collectionRate: number;
  months: ProjectionMonth[];
}

interface Tiles {
  attention: {
    unmatchedBankLines: number;
    uncategorizedExpenses: number;
    overdueInvoices: number;
    vyuctovanieDeadline: {
      year: number;
      deadline: string;
      daysUntil: number;
      sanctionActive: boolean;
    } | null;
  };
  openingPosted: boolean;
  pokladnicaCents: number;
  bankaCents: number;
  fondOpravCents: number;
  nedoplatky: { count: number; totalCents: number };
}

export default function AccountingHomePage() {
  const t = useTranslations("Accounting.home");
  const format = useFormatter();

  const [tiles, setTiles] = useState<Tiles | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [drillMonth, setDrillMonth] = useState<number | null>(null);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/dashboard")
      .then((r) => {
        if (r.status === 403) {
          setOwnerOnly(true);
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Tiles | null) => {
        if (data) setTiles(data);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    fetch("/api/accounting/projection")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Projection | null) => {
        if (data) setProjection(data);
      })
      .catch(() => {});
  }, []);

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }

  if (ownerOnly) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("title")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t("ownerSubtitle")}
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link
            href="/accounting/karta"
            className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4 hover:border-blue-400 dark:hover:border-blue-600"
          >
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
              🧾 {t("navKarta")}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t("navKartaOwnerHint")}
            </p>
          </Link>
          <Link
            href="/accounting/meters"
            className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4 hover:border-blue-400 dark:hover:border-blue-600"
          >
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
              🌡️ {t("navMeters")}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t("navMetersHint")}
            </p>
          </Link>
          <Link
            href="/accounting/inspect"
            className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4 hover:border-blue-400 dark:hover:border-blue-600"
          >
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
              🔍 {t("navInspect")}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t("navInspectHint")}
            </p>
          </Link>
        </div>
      </div>
    );
  }

  if (!tiles) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const tileClass =
    "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {!tiles.openingPosted && (
        <Link
          href="/accounting/onboarding/opening-balance"
          className="block mb-6 bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-lg px-5 py-4 hover:border-amber-400"
        >
          <span className="font-medium text-amber-900 dark:text-amber-200">
            ⚠️ {t("onboardingCta")}
          </span>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
            {t("onboardingHint")}
          </p>
        </Link>
      )}

      {/* 4 tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={tileClass}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("tilePokladnica")}
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {formatEur(tiles.pokladnicaCents)}
          </p>
        </div>
        <div className={tileClass}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("tileBanka")}
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {formatEur(tiles.bankaCents)}
          </p>
        </div>
        <div className={tileClass}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("tileFondOprav")}
          </p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {formatEur(tiles.fondOpravCents)}
          </p>
        </div>
        <div className={tileClass}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("tileNedoplatky")}
          </p>
          <p
            className={`text-xl font-bold ${
              tiles.nedoplatky.count > 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {formatEur(tiles.nedoplatky.totalCents)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("nedoplatkyCount", { count: tiles.nedoplatky.count })}
          </p>
        </div>
      </div>

      {/* 6-month cash-flow projection */}
      {projection && projection.months.length > 0 && (
        <div className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            {t("projectionTitle")}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {t("projectionHint", {
              rate: Math.round(projection.collectionRate * 100),
            })}
          </p>
          {(() => {
            // Bars scale against the best POSITIVE month; a negative month
            // must never render as the tallest bar (height would read as
            // "best month" at a glance) — it gets a fixed stub + ⚠ label.
            const maxPositive = Math.max(
              1,
              ...projection.months.map((m) => Math.max(0, m.closingCents))
            );
            return (
              <div className="flex items-end gap-3 h-40">
                {projection.months.map((m, i) => {
                  const negative = m.closingCents < 0;
                  const height = negative
                    ? 8
                    : Math.max(
                        4,
                        Math.round((m.closingCents / maxPositive) * 100)
                      );
                  return (
                    <button
                      type="button"
                      key={`${m.year}-${m.month}`}
                      onClick={() =>
                        setDrillMonth((prev) => (prev === i ? null : i))
                      }
                      className={`flex-1 flex flex-col items-center justify-end gap-1 cursor-pointer rounded ${
                        drillMonth === i
                          ? "ring-2 ring-blue-400 dark:ring-blue-600"
                          : ""
                      }`}
                      title={formatEur(m.closingCents)}
                    >
                      <span
                        className={`text-[10px] whitespace-nowrap ${
                          negative
                            ? "text-red-600 dark:text-red-400 font-semibold"
                            : "text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {negative ? "⚠ " : ""}
                        {formatEur(m.closingCents)}
                      </span>
                      <div
                        className={`w-full rounded-t ${
                          negative
                            ? "bg-red-500 dark:bg-red-600"
                            : m.estimated
                              ? "bg-blue-300 dark:bg-blue-800"
                              : "bg-blue-500 dark:bg-blue-600"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        {format.dateTime(
                          new Date(Date.UTC(m.year, m.month - 1, 1)),
                          { month: "short" }
                        )}
                        {m.estimated ? "*" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {drillMonth !== null && projection.months[drillMonth] && (
            <div className="mt-4 bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm">
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                {format.dateTime(
                  new Date(
                    Date.UTC(
                      projection.months[drillMonth].year,
                      projection.months[drillMonth].month - 1,
                      1
                    )
                  ),
                  { month: "long", year: "numeric" }
                )}
              </p>
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-gray-600 dark:text-gray-400">
                    {t("projectionDrillInflow")}
                  </dt>
                  <dd className="text-green-700 dark:text-green-400">
                    +{formatEur(projection.months[drillMonth].expectedInflowCents)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600 dark:text-gray-400">
                    {t("projectionDrillExpense")}
                  </dt>
                  <dd className="text-red-600 dark:text-red-400">
                    −{formatEur(projection.months[drillMonth].expenseCents)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1 font-medium">
                  <dt className="text-gray-900 dark:text-gray-100">
                    {t("projectionDrillClosing")}
                  </dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {formatEur(projection.months[drillMonth].closingCents)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          {projection.months.some((m) => m.estimated) && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
              {t("projectionEstimatedNote")}
            </p>
          )}
        </div>
      )}

      {/* Vyžaduje pozornosť */}
      {(tiles.attention.unmatchedBankLines > 0 ||
        tiles.attention.uncategorizedExpenses > 0 ||
        tiles.attention.overdueInvoices > 0 ||
        tiles.attention.vyuctovanieDeadline !== null ||
        tiles.nedoplatky.count > 0) && (
        <div className="mb-8 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            ⚠️ {t("attentionTitle")}
          </h2>
          <ul className="space-y-2 text-sm">
            {tiles.attention.vyuctovanieDeadline && (
              <li>
                <Link
                  href="/accounting/vyuctovanie"
                  className={
                    tiles.attention.vyuctovanieDeadline.sanctionActive
                      ? "text-red-600 dark:text-red-400 font-medium hover:underline"
                      : "text-amber-700 dark:text-amber-400 hover:underline"
                  }
                >
                  {tiles.attention.vyuctovanieDeadline.sanctionActive
                    ? t("attentionVyuctovanieOverdue", {
                        year: tiles.attention.vyuctovanieDeadline.year,
                      })
                    : t("attentionVyuctovanieDue", {
                        year: tiles.attention.vyuctovanieDeadline.year,
                        days: tiles.attention.vyuctovanieDeadline.daysUntil,
                      })}
                </Link>
              </li>
            )}
            {tiles.attention.unmatchedBankLines > 0 && (
              <li>
                <Link
                  href="/accounting/reconciliation"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("attentionUnmatched", {
                    count: tiles.attention.unmatchedBankLines,
                  })}
                </Link>
              </li>
            )}
            {tiles.attention.uncategorizedExpenses > 0 && (
              <li>
                <Link
                  href="/accounting/expenses"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("attentionUncategorized", {
                    count: tiles.attention.uncategorizedExpenses,
                  })}
                </Link>
              </li>
            )}
            {tiles.attention.overdueInvoices > 0 && (
              <li>
                <Link
                  href="/accounting/expenses"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("attentionOverdueInvoices", {
                    count: tiles.attention.overdueInvoices,
                  })}
                </Link>
              </li>
            )}
            {tiles.nedoplatky.count > 0 && (
              <li>
                <Link
                  href="/accounting/karta"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t("attentionOverdueUnits", {
                    count: tiles.nedoplatky.count,
                  })}
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Navigation */}
      <div className="grid sm:grid-cols-2 gap-4">
        {(
          [
            ["/accounting/predpis", "🧮", "navPredpis", "navPredpisHint"],
            ["/accounting/payments", "💳", "navPayments", "navPaymentsHint"],
            [
              "/accounting/reconciliation",
              "🏦",
              "navReconciliation",
              "navReconciliationHint",
            ],
            ["/accounting/expenses", "🧰", "navExpenses", "navExpensesHint"],
            ["/accounting/meters", "🌡️", "navMeters", "navMetersHint"],
            [
              "/accounting/vyuctovanie",
              "📑",
              "navVyuctovanie",
              "navVyuctovanieHint",
            ],
            ["/accounting/karta", "🧾", "navKarta", "navKartaHint"],
            [
              "/accounting/predpis/unit-settings",
              "🔢",
              "navVs",
              "navVsHint",
            ],
            ["/accounting/inspect", "🔍", "navInspect", "navInspectHint"],
            ["/accounting/revisions", "🔧", "navRevisions", "navRevisionsHint"],
            ["/accounting/debtors", "📋", "navDebtors", "navDebtorsHint"],
            ["/accounting/journal", "📚", "navJournal", "navJournalHint"],
            ["/accounting/settings", "⚙️", "navSettings", "navSettingsHint"],
          ] as const
        ).map(([href, icon, label, hint]) => (
          <Link
            key={href}
            href={href}
            className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4 hover:border-blue-400 dark:hover:border-blue-600"
          >
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {icon} {t(label)}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t(hint)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

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
            const maxAbs = Math.max(
              1,
              ...projection.months.map((m) => Math.abs(m.closingCents))
            );
            return (
              <div className="flex items-end gap-3 h-40">
                {projection.months.map((m) => {
                  const height = Math.round(
                    (Math.abs(m.closingCents) / maxAbs) * 100
                  );
                  const negative = m.closingCents < 0;
                  return (
                    <div
                      key={`${m.year}-${m.month}`}
                      className="flex-1 flex flex-col items-center justify-end gap-1"
                      title={formatEur(m.closingCents)}
                    >
                      <span className="text-[10px] text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatEur(m.closingCents)}
                      </span>
                      <div
                        className={`w-full rounded-t ${
                          negative
                            ? "bg-red-400 dark:bg-red-600"
                            : m.estimated
                              ? "bg-blue-300 dark:bg-blue-800"
                              : "bg-blue-500 dark:bg-blue-600"
                        }`}
                        style={{ height: `${Math.max(4, height)}%` }}
                      />
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        {format.dateTime(
                          new Date(Date.UTC(m.year, m.month - 1, 1)),
                          { month: "short" }
                        )}
                        {m.estimated ? "*" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
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
        tiles.nedoplatky.count > 0) && (
        <div className="mb-8 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            ⚠️ {t("attentionTitle")}
          </h2>
          <ul className="space-y-2 text-sm">
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
            ["/accounting/karta", "🧾", "navKarta", "navKartaHint"],
            [
              "/accounting/predpis/unit-settings",
              "🔢",
              "navVs",
              "navVsHint",
            ],
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

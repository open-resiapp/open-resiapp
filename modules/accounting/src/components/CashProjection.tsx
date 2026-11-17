"use client";

// 6-month cash projection on the Financie overview (BYT-20261117-002).
// One plain sentence up front; the chart, pool switch and month drill-down
// live inside a collapsed "Podrobnosti" disclosure. Estimate only — nothing
// is posted.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";

export interface ProjectionMonth {
  month: number;
  year: number;
  expectedInflowCents: number;
  expenseCents: number;
  closingCents: number;
  estimated: boolean;
}

export interface Projection {
  openingCents: number;
  collectionRate: number;
  months: ProjectionMonth[];
  pools?: { pool: string; openingCents: number; months: ProjectionMonth[] }[];
}

export default function CashProjection({ projection }: { projection: Projection }) {
  const t = useTranslations("Accounting.home");
  const format = useFormatter();
  const [pool, setPool] = useState<string>("total");
  const [drill, setDrill] = useState<number | null>(null);

  const totalMonths = projection.months;
  const last = totalMonths[totalMonths.length - 1];
  if (!last) return null;

  const months =
    pool === "total"
      ? totalMonths
      : projection.pools?.find((p) => p.pool === pool)?.months ?? totalMonths;

  // Bars scale against the best POSITIVE month; a negative month never
  // renders as the tallest bar — it gets a short red stub and a label.
  const maxPositive = Math.max(1, ...months.map((m) => Math.max(0, m.closingCents)));
  const monthLabel = (m: ProjectionMonth, style: "short" | "long") =>
    format.dateTime(new Date(Date.UTC(m.year, m.month - 1, 1)), {
      month: style,
      ...(style === "long" ? { year: "numeric" } : {}),
    });
  const drillMonth = drill !== null ? months[drill] : undefined;

  return (
    <div>
      <p className="text-base text-ui-text">
        {t("projectionSentence", {
          months: totalMonths.length,
          amount: formatEur(last.closingCents),
        })}
      </p>
      {last.closingCents < 0 && (
        <p className="mt-1 text-base font-medium text-ui-danger">
          {t("projectionNegative")}
        </p>
      )}
      <details className="group mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg text-base font-medium text-ui-primary hover:underline">
          {t("projectionDetails")}
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-base text-ui-text-muted">
            {t("projectionHint", { rate: Math.round(projection.collectionRate * 100) })}
          </p>

          {projection.pools && projection.pools.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("projectionPoolLabel")}>
              {[
                { key: "total", label: t("poolTotal") },
                { key: "fpuo", label: t("poolFpuo") },
                { key: "svc", label: t("poolSvc") },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={pool === opt.key}
                  onClick={() => {
                    setPool(opt.key);
                    setDrill(null);
                  }}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-base",
                    pool === opt.key
                      ? "border-ui-primary bg-ui-primary text-ui-primary-text"
                      : "border-ui-border-strong text-ui-text hover:bg-ui-surface-muted",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Bars: fixed-height plot area so the percentage heights resolve
              (they collapsed to 0 inside an auto-height button before).
              No value labels on the bars — the list below carries them, so
              nothing overflows at 390 px. */}
          <div className="flex h-36 items-end gap-2" aria-hidden="true">
            {months.map((m, i) => {
              const negative = m.closingCents < 0;
              const height = negative
                ? 6
                : Math.max(4, Math.round((m.closingCents / maxPositive) * 100));
              return (
                <div key={`${m.year}-${m.month}`} className="flex h-full min-w-0 flex-1 items-end">
                  <div
                    className={cn(
                      "w-full rounded-t",
                      negative ? "bg-ui-danger" : m.estimated ? "bg-ui-primary/50" : "bg-ui-primary",
                      drill === i && "ring-2 ring-ui-focus",
                    )}
                    style={{ height: `${height}%` }}
                  />
                </div>
              );
            })}
          </div>

          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {months.map((m, i) => (
              <li key={`${m.year}-${m.month}`}>
                <button
                  type="button"
                  aria-expanded={drill === i}
                  onClick={() => setDrill((prev) => (prev === i ? null : i))}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-base hover:bg-ui-surface-muted",
                    drill === i && "bg-ui-surface-muted",
                  )}
                >
                  <span className="text-ui-text-muted">
                    {monthLabel(m, "long")}
                    {m.estimated ? " *" : ""}
                  </span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      m.closingCents < 0 ? "text-ui-danger" : "text-ui-text",
                    )}
                  >
                    {formatEur(m.closingCents)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {drillMonth && (
            <div className="rounded-lg bg-ui-surface-muted p-4 text-base">
              <p className="mb-2 font-medium text-ui-text">{monthLabel(drillMonth, "long")}</p>
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-ui-text-muted">{t("projectionDrillInflow")}</dt>
                  <dd className="tabular-nums text-ui-text">
                    +{formatEur(drillMonth.expectedInflowCents)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ui-text-muted">{t("projectionDrillExpense")}</dt>
                  <dd className="tabular-nums text-ui-text">
                    −{formatEur(drillMonth.expenseCents)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-ui-border pt-1 font-medium">
                  <dt className="text-ui-text">{t("projectionDrillClosing")}</dt>
                  <dd className="tabular-nums text-ui-text">{formatEur(drillMonth.closingCents)}</dd>
                </div>
              </dl>
            </div>
          )}

          {months.some((m) => m.estimated) && (
            <p className="text-base text-ui-text-muted">{t("projectionEstimatedNote")}</p>
          )}
        </div>
      </details>
    </div>
  );
}

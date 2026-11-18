"use client";

// Zoznam dlžníkov (§11 zák. 182/1993) — shown only when the shromaždenie
// approved disclosure and a treasurer set the threshold. Unit label +
// amount only, never owner names (privacy-safe).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";
import ExportButtons from "@modules/accounting/src/components/ExportButtons";
import { DownloadUpomienkyBulkButton } from "@modules/accounting/src/components/DownloadUpomienkaButton";

interface DebtorRow {
  /** Present for the board audience only. */
  unitId?: string;
  unitLabel: string;
  balanceCents: number;
  ownerNames: string[] | null;
}
interface Payload {
  /** "board" = treasurer / chairman / admin full list (BYT-20261117-001 Decided 2). */
  audience: "board" | "owner";
  enabled: boolean;
  thresholdCents: number | null;
  namesEnabled: boolean;
  nameThresholdCents: number;
  debtors: DebtorRow[];
  canWrite?: boolean;
  country?: "sk" | "cz";
}

export default function DebtorsPage() {
  const t = useTranslations("Accounting.debtors");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/debtors")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: Payload) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-base text-ui-danger">
        {t("loadError")}
      </p>
    );
  }
  if (!data) {
    return <div className="h-40 animate-pulse rounded-lg bg-ui-surface-muted" />;
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/accounting"
        className="inline-flex min-h-11 items-center text-base font-medium text-ui-primary hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-ui-text">{t("title")}</h1>

      {!data.enabled ? (
        <p className="mt-4 text-base text-ui-text-muted">{t("disabled")}</p>
      ) : (
        <>
          <p className="mb-4 text-base text-ui-text-muted">
            {data.audience === "board"
              ? t("boardSubtitle")
              : t("subtitle", { threshold: formatEur(data.thresholdCents ?? 0) })}
          </p>
          {data.audience === "board" && (
            <>
              {/* Same net figure as the karta bytu (311 + 379): a flat whose
                  preplatok covers its arrears is not a debtor. */}
              <p className="mb-4 text-base text-ui-text-muted">{t("boardNetNote")}</p>
              <div className="mb-6 flex flex-wrap gap-2">
                <ExportButtons report="debtors" />
                {data.canWrite && data.country === "sk" && data.debtors.length > 0 && (
                  <DownloadUpomienkyBulkButton />
                )}
              </div>
            </>
          )}
          {data.debtors.length === 0 ? (
            <p className="text-base text-ui-success">
              {data.audience === "board" ? t("boardNone") : t("none")}
            </p>
          ) : (
            // Card list instead of a table: fits 390 px without sideways scroll.
            <ul className="divide-y divide-ui-border rounded-lg border border-ui-border bg-ui-surface">
              {data.debtors.map((d) => (
                <li
                  key={d.unitId ?? d.unitLabel}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-ui-text">
                      <span className="sr-only">{t("colUnit")}: </span>
                      {d.unitId ? (
                        <Link
                          href={`/accounting/karta/${d.unitId}`}
                          className="inline-flex min-h-11 items-center text-ui-primary hover:underline"
                        >
                          {d.unitLabel}
                        </Link>
                      ) : (
                        d.unitLabel
                      )}
                    </p>
                    {data.namesEnabled && (
                      <p className="break-words text-base text-ui-text-muted">
                        <span className="sr-only">{t("colOwner")}: </span>
                        {d.ownerNames && d.ownerNames.length > 0
                          ? d.ownerNames.join(", ")
                          : data.audience === "board"
                            ? t("boardNoOwner")
                            : /* Below the statutory 500 € → withheld. */
                              t("nameWithheld")}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-base font-semibold text-ui-danger">
                    <span className="sr-only">{t("colAmount")}: </span>
                    {formatEur(d.balanceCents)}
                  </p>
                </li>
              ))}
              <li className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3 font-semibold">
                <p className="text-base text-ui-text">
                  {t("totalRow", { count: data.debtors.length })}
                </p>
                <p className="text-base text-ui-danger">
                  {formatEur(data.debtors.reduce((s, d) => s + d.balanceCents, 0))}
                </p>
              </li>
            </ul>
          )}
          <p className="mt-3 text-base text-ui-text-muted">
            {data.audience === "board" ? t("boardNote") : t("legalNote")}
          </p>
        </>
      )}
    </div>
  );
}

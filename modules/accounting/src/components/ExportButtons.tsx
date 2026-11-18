"use client";

// CSV + XLSX download links for an accounting report (auditor exports).
// Plain <a download> to the API — the server builds the file (with a
// totals row) and resolves column headers in the viewer's locale.

import { useLocale, useTranslations } from "next-intl";
import { buttonClasses } from "@/components/ui";

export type ReportKind =
  | "trial-balance"
  | "payments"
  | "debtors"
  | "unit-card"
  | "fpuo";

export default function ExportButtons({
  report,
  params = {},
}: {
  report: ReportKind;
  /** Extra query params (year, from, to, unit…); empty values are dropped. */
  params?: Record<string, string | number | null | undefined>;
}) {
  const t = useTranslations("Accounting.reports");
  const locale = useLocale();

  const href = (format: "csv" | "xlsx") => {
    const qs = new URLSearchParams({ format, locale });
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    }
    return `/api/accounting/reports/${report}?${qs.toString()}`;
  };

  return (
    <span className="flex flex-wrap gap-2">
      <a href={href("xlsx")} download className={buttonClasses({ variant: "secondary" })}>
        {t("exportXlsx")}
      </a>
      <a href={href("csv")} download className={buttonClasses({ variant: "secondary" })}>
        {t("exportCsv")}
      </a>
    </span>
  );
}

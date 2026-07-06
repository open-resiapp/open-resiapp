"use client";

// Revízie — technical-audit expiry tracking (BYT-20260512-002 Phase 3).
// Latest inspection per category with a computed status; overdue safety
// revisions (elektro/plyn/výťah) are a liability, so they sort first and
// glow red. Export to .ics to drop the deadlines into any calendar.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

interface RevisionRow {
  categorySlug: string;
  supplierName: string;
  lastInspectionDate: string;
  nextDueAt: string;
  daysUntilDue: number;
  status: "overdue" | "due_soon" | "ok";
}

export default function RevisionsPage() {
  const t = useTranslations("Accounting.revisions");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();

  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/revisions")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { revisions: RevisionRow[] }) => setRows(d.revisions))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!rows) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const statusClass = {
    overdue: "text-red-600 dark:text-red-400",
    due_soon: "text-amber-700 dark:text-amber-400",
    ok: "text-green-700 dark:text-green-400",
  } as const;

  return (
    <div className="max-w-4xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        {rows.length > 0 && (
          <a
            href="/api/accounting/revisions/ics"
            className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg text-sm"
          >
            {t("exportIcs")}
          </a>
        )}
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colCategory")}</th>
                <th className="py-2 pr-4">{t("colSupplier")}</th>
                <th className="py-2 pr-4">{t("colLast")}</th>
                <th className="py-2 pr-4">{t("colNext")}</th>
                <th className="py-2">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.categorySlug}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {tCat(r.categorySlug as Parameters<typeof tCat>[0])}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {r.supplierName}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {format.dateTime(new Date(r.lastInspectionDate), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {format.dateTime(new Date(r.nextDueAt), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className={`py-2 font-medium ${statusClass[r.status]}`}>
                    {t(
                      r.status === "overdue"
                        ? "statusOverdue"
                        : r.status === "due_soon"
                          ? "statusSoon"
                          : "statusOk"
                    )}
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      {r.daysUntilDue < 0
                        ? t("daysOverdue", { days: -r.daysUntilDue })
                        : t("daysLeft", { days: r.daysUntilDue })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

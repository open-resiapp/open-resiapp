"use client";

// Právo na nahliadnutie (BYT-20260512-002, §11 ods. 6 zák. 182/1993).
// Every owner of the dom reads the community's spending: supplier,
// invoice, amount, and — where visibility allows — the scan. Restricted
// dokladed show as "board only"; redacted ones link the redacted copy.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface InspectRow {
  expenseId: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  categorySlug: string | null;
  okruh: "fpuo" | "svc" | "mgmt";
  amountCents: number;
  visibility: "public" | "redacted_required" | "restricted";
  viewableAttachmentId: string | null;
  hasAttachment: boolean;
}

export default function InspectPage() {
  const t = useTranslations("Accounting.inspect");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();

  const [rows, setRows] = useState<InspectRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/inspect")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { expenses: InspectRow[] }) => setRows(d.expenses))
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

  return (
    <div className="max-w-4xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {rows.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4">{t("colDate")}</th>
                <th className="py-2 pr-4">{t("colSupplier")}</th>
                <th className="py-2 pr-4">{t("colCategory")}</th>
                <th className="py-2 pr-4 text-right">{t("colAmount")}</th>
                <th className="py-2">{t("colDoc")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.expenseId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 pr-4 whitespace-nowrap text-gray-900 dark:text-gray-100">
                    {format.dateTime(new Date(r.invoiceDate), {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {r.supplierName}
                    <span className="text-gray-400 ml-2">{r.invoiceNo}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {r.categorySlug
                      ? tCat(r.categorySlug as Parameters<typeof tCat>[0])
                      : "—"}
                    {r.okruh === "fpuo" && (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                        {t("fpuoBadge")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                    {formatEur(r.amountCents)}
                  </td>
                  <td className="py-2">
                    {r.viewableAttachmentId ? (
                      <a
                        href={`/api/accounting/attachments/${r.viewableAttachmentId}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        📎 {t("viewDoc")}
                      </a>
                    ) : r.visibility === "restricted" ? (
                      <span className="text-gray-400 text-xs">
                        {t("boardOnly")}
                      </span>
                    ) : r.hasAttachment ? (
                      <span className="text-gray-400 text-xs">
                        {t("redactionPending")}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">
                        {t("noDoc")}
                      </span>
                    )}
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

"use client";

// Zoznam dlžníkov (§11 zák. 182/1993) — shown only when the shromaždenie
// approved disclosure and a treasurer set the threshold. Unit label +
// amount only, never owner names (privacy-safe).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface DebtorRow {
  unitLabel: string;
  balanceCents: number;
}
interface Payload {
  enabled: boolean;
  thresholdCents: number | null;
  debtors: DebtorRow[];
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
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!data) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/accounting"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToAccounting")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>

      {!data.enabled ? (
        <p className="text-gray-600 dark:text-gray-400 mt-4">
          {t("disabled")}
        </p>
      ) : (
        <>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t("subtitle", { threshold: formatEur(data.thresholdCents ?? 0) })}
          </p>
          {data.debtors.length === 0 ? (
            <p className="text-green-700 dark:text-green-400">{t("none")}</p>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-4">{t("colUnit")}</th>
                    <th className="py-2 text-right">{t("colAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.debtors.map((d) => (
                    <tr
                      key={d.unitLabel}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {d.unitLabel}
                      </td>
                      <td className="py-2 text-right font-medium text-red-600 dark:text-red-400">
                        {formatEur(d.balanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            {t("legalNote")}
          </p>
        </>
      )}
    </div>
  );
}

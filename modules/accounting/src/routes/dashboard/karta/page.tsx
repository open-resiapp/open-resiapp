"use client";

// Karta bytu — unit list (BYT-20260512-002 Phase 1 slice 4). Board roles
// see every unit of the dom with its balance; owners see their own units
// only (scoping is server-side; this page just renders what the API
// returns). Positive balance = owner owes (domain sign convention).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface UnitRow {
  id: string;
  name: string;
  flatNumber: string | null;
  balanceCents: number;
}

export default function KartaListPage() {
  const t = useTranslations("Accounting.karta");
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/karta")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { units: UnitRow[] }) => setUnits(data.units))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!units) {
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
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      {units.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {units.map((u) => (
            <li key={u.id}>
              <Link
                href={`/accounting/karta/${u.id}`}
                className="flex items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 hover:border-blue-400 dark:hover:border-blue-600"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {u.flatNumber ?? u.name}
                </span>
                <span
                  className={`font-medium ${
                    u.balanceCents > 0
                      ? "text-red-600 dark:text-red-400"
                      : u.balanceCents < 0
                        ? "text-green-700 dark:text-green-400"
                        : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {formatEur(u.balanceCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
        {t("signHint")}
      </p>
    </div>
  );
}

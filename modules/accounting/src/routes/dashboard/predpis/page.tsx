"use client";

// Predpis list (BYT-20260512-002 Phase 1). Lists fee schedules per year,
// creates drafts, links to the editor and to VS assignment. Publish flow
// lives on the schedule detail page.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";

interface ScheduleRow {
  id: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: string;
  effectiveTo: string | null;
  serviceCount: number;
}

export default function PredpisListPage() {
  const t = useTranslations("Accounting.predpis");
  const format = useFormatter();
  const router = useRouter();

  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/fee-schedules")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { schedules: ScheduleRow[] }) => setSchedules(data.schedules))
      .catch(() => setError("load"));
  }, []);

  async function createDraft() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/fee-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      router.push(`/accounting/predpis/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create");
      setCreating(false);
    }
  }

  if (error === "load") {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!schedules) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
            {t("title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/accounting/predpis/unit-settings"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
        >
          {t("unitSettingsLink")}
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          min={2000}
          max={2100}
          className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <button
          onClick={createDraft}
          disabled={creating || !Number.isInteger(year)}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
        >
          {creating ? t("creating") : t("newSchedule")}
        </button>
      </div>

      {error && error !== "load" && (
        <p className="text-red-600 dark:text-red-400 text-sm mb-4">
          {t("submitError")} ({error})
        </p>
      )}

      {schedules.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li key={s.id}>
              <Link
                href={`/accounting/predpis/${s.id}`}
                className="flex items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 hover:border-blue-400 dark:hover:border-blue-600"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {s.year}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400 ml-3">
                    {t("effectiveFromShort")}{" "}
                    {format.dateTime(new Date(s.effectiveFrom), {
                      dateStyle: "medium",
                    })}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400 ml-3">
                    {t("serviceCount", { count: s.serviceCount })}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    s.status === "published"
                      ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                      : "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
                  }`}
                >
                  {t(`status.${s.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

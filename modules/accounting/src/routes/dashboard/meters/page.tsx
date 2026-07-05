"use client";

// Meter readings (BYT-20260512-002 Phase 4 input + owner self-service).
// Owners record readings for their own units; the board for any unit.
// Values in meter units with up to 3 decimals (stored as thousandths).
// Corrections: void the row and enter the value again.

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type MeterType = "heat" | "water_cold" | "water_hot" | "electricity";
const METER_TYPES: MeterType[] = [
  "heat",
  "water_cold",
  "water_hot",
  "electricity",
];

interface UnitOption {
  id: string;
  name: string;
  flatNumber: string | null;
}

interface Reading {
  id: string;
  meterType: MeterType;
  readingDate: string;
  valueMilli: number;
  createdById: string;
}

/** "123,456" | "123.4" → thousandths; null on garbage. */
function parseMilli(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return parseInt(whole, 10) * 1000 + parseInt(frac.padEnd(3, "0") || "0", 10);
}

function milliToDisplay(milli: number): string {
  return (milli / 1000).toLocaleString("sk-SK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export default function MetersPage() {
  const t = useTranslations("Accounting.meters");
  const format = useFormatter();

  const [units, setUnits] = useState<UnitOption[] | null>(null);
  const [unitId, setUnitId] = useState("");
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [meterType, setMeterType] = useState<MeterType>("water_cold");
  const [readingDate, setReadingDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadUnits = useCallback(() => {
    fetch("/api/accounting/meters")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { units: UnitOption[] }) => {
        setUnits(data.units);
        setUnitId((prev) => prev || data.units[0]?.id || "");
      })
      .catch(() => setError("load"));
  }, []);

  const loadReadings = useCallback(() => {
    if (!unitId) return;
    fetch(`/api/accounting/meters?unitId=${encodeURIComponent(unitId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { readings: Reading[] }) => setReadings(data.readings))
      .catch(() => setError("load"));
  }, [unitId]);

  useEffect(loadUnits, [loadUnits]);
  useEffect(loadReadings, [loadReadings]);

  const valueMilli = parseMilli(value);
  const formValid =
    unitId !== "" &&
    valueMilli !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(readingDate);

  async function submit() {
    if (!formValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/meters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitEntityId: unitId,
          meterType,
          readingDate: new Date(`${readingDate}T00:00:00Z`).toISOString(),
          valueMilli,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setValue("");
      loadReadings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function voidReading(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/meters/${id}/void`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      loadReadings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "void");
    } finally {
      setBusy(null);
    }
  }

  if (error === "load") {
    return <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>;
  }
  if (!units) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }

  const inputClass =
    "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm";

  return (
    <div className="max-w-3xl">
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
        <p className="text-gray-600 dark:text-gray-400">{t("noUnits")}</p>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {t("unit")}
                </span>
                <select
                  value={unitId}
                  onChange={(e) => {
                    setUnitId(e.target.value);
                    setReadings(null);
                  }}
                  className={inputClass}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.flatNumber ?? u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {t("meterType")}
                </span>
                <select
                  value={meterType}
                  onChange={(e) => setMeterType(e.target.value as MeterType)}
                  className={inputClass}
                >
                  {METER_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {t(`type_${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {t("readingDate")}
                </span>
                <input
                  type="date"
                  value={readingDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setReadingDate(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {t("value")}
                </span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={t("valuePlaceholder")}
                  inputMode="decimal"
                  className={`${inputClass} w-32 text-right`}
                />
              </label>
              <button
                onClick={submit}
                disabled={submitting || !formValid}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {submitting ? t("saving") : t("save")}
              </button>
            </div>
            {error && error !== "load" && (
              <p className="text-red-600 dark:text-red-400 text-sm mt-3">
                {t("submitError")} ({error})
              </p>
            )}
          </div>

          {readings === null ? (
            <div className="animate-pulse h-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          ) : readings.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">{t("empty")}</p>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-4">{t("colDate")}</th>
                    <th className="py-2 pr-4">{t("colType")}</th>
                    <th className="py-2 pr-4 text-right">{t("colValue")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {format.dateTime(new Date(r.readingDate), {
                          dateStyle: "medium",
                        })}
                      </td>
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {t(`type_${r.meterType}`)}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                        {milliToDisplay(r.valueMilli)}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => voidReading(r.id)}
                          disabled={busy === r.id}
                          className="text-red-600 dark:text-red-400 hover:underline text-xs disabled:opacity-50"
                        >
                          {t("void")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

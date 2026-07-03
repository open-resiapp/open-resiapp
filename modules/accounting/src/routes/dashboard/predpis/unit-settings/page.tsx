"use client";

// VS assignment (BYT-20260512-002 Phase 1). Variabilný symbol per unit —
// the primary payment-matching key (domain edge case 9), 1-10 digits,
// unique within the dom. Auto-fill derives VS from flat numbers where
// they are numeric; treasurer reviews before saving.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { VS_RE } from "@modules/accounting/src/lib/constants";

interface UnitRow {
  unitEntityId: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
}

export default function UnitVsPage() {
  const t = useTranslations("Accounting.unitSettings");

  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/unit-settings")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { units: UnitRow[] }) => {
        setUnits(data.units);
        setValues(
          Object.fromEntries(data.units.map((u) => [u.unitEntityId, u.vs ?? ""]))
        );
      })
      .catch(() => setError("load"));
  }, []);

  function autoFill() {
    if (!units) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const u of units) {
        if (next[u.unitEntityId]) continue;
        const digits = (u.flatNumber ?? "").replace(/\D/g, "");
        if (digits && digits.length <= 10) next[u.unitEntityId] = digits;
      }
      return next;
    });
  }

  // All rows submit — an emptied field unassigns the unit's VS server-side.
  const assignments = units
    ? units.map((u) => ({
        unitEntityId: u.unitEntityId,
        vs: values[u.unitEntityId]?.trim() ?? "",
      }))
    : [];
  const nonEmpty = assignments.filter((a) => a.vs !== "");
  const allValid = nonEmpty.every((a) => VS_RE.test(a.vs));
  const noDuplicates = new Set(nonEmpty.map((a) => a.vs)).size === nonEmpty.length;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/accounting/unit-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save");
    } finally {
      setSaving(false);
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

  return (
    <div className="max-w-2xl">
      <Link
        href="/accounting/predpis"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← {t("backToList")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">{t("subtitle")}</p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex justify-end mb-3">
          <button
            onClick={autoFill}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t("autoFill")}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-4">{t("unit")}</th>
              <th className="py-2 text-right">{t("vs")}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const v = values[u.unitEntityId] ?? "";
              const invalid = v !== "" && !VS_RE.test(v.trim());
              return (
                <tr
                  key={u.unitEntityId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                    {u.flatNumber ?? u.name}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      value={v}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [u.unitEntityId]: e.target.value,
                        }))
                      }
                      inputMode="numeric"
                      maxLength={10}
                      className={`w-40 px-3 py-2 border rounded-lg text-right bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                        invalid
                          ? "border-red-500"
                          : "border-gray-300 dark:border-gray-600"
                      }`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!noDuplicates && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("duplicateVs")}
          </p>
        )}
        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-3">
            {t("submitError")} ({error})
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-4">
          {saved && (
            <span className="text-sm text-green-700 dark:text-green-400">
              {t("savedOk")}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !allValid || !noDuplicates}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

// Accounting settings (BYT-20260512-002 Phase 1): allocation strategy
// (proportional vs priority-ordered with per-HOA category order) + the
// dom's collection IBAN (validated MOD-97 client- AND server-side). Every
// save appends a new effective-from row — history stays auditable.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { isValidIban } from "@modules/accounting/src/lib/iban";
import { parseCents, centsToInput } from "@modules/accounting/src/lib/money";

interface Settings {
  allocationStrategy: "proportional" | "priority_ordered";
  priorityOrder: string[];
  bankIban: string | null;
  dueDay: number | null;
  debtorDisclosureThresholdCents: number | null;
  categorySlugs: string[];
}

export default function AccountingSettingsPage() {
  const t = useTranslations("Accounting.settings");
  const tCat = useTranslations("Accounting.serviceCategories");

  const [loaded, setLoaded] = useState(false);
  const [strategy, setStrategy] = useState<Settings["allocationStrategy"]>("proportional");
  const [order, setOrder] = useState<string[]>([]);
  const [iban, setIban] = useState("");
  const [dueDay, setDueDay] = useState<string>("");
  const [debtorThreshold, setDebtorThreshold] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/settings")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Settings) => {
        setStrategy(data.allocationStrategy);
        // Full catalog, saved order first — the editor always shows every
        // category so the treasurer sees the complete sequence.
        const rest = data.categorySlugs.filter(
          (s) => !data.priorityOrder.includes(s)
        );
        setOrder([...data.priorityOrder, ...rest]);
        setIban(data.bankIban ?? "");
        setDueDay(data.dueDay === null ? "" : String(data.dueDay));
        setDebtorThreshold(
          data.debtorDisclosureThresholdCents === null
            ? ""
            : centsToInput(data.debtorDisclosureThresholdCents)
        );
        setLoaded(true);
      })
      .catch(() => setError("load"));
  }, []);

  const ibanValid = iban.trim() === "" || isValidIban(iban);

  function move(index: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/accounting/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationStrategy: strategy,
          // Always sent — the arranged order survives a round-trip through
          // the proportional strategy.
          priorityOrder: order,
          bankIban: iban.trim() || null,
          dueDay: dueDay === "" ? null : Number(dueDay),
          debtorDisclosureThresholdCents:
            debtorThreshold.trim() === "" ? null : parseCents(debtorThreshold),
        }),
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
  if (!loaded) {
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

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-6">
        {/* IBAN */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            {t("iban")}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t("ibanHint")}
          </p>
          <input
            value={iban}
            onChange={(e) => {
              setIban(e.target.value);
              setSaved(false);
            }}
            placeholder={t("ibanPlaceholder")}
            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono ${
              ibanValid
                ? "border-gray-300 dark:border-gray-600"
                : "border-red-500"
            }`}
          />
          {!ibanValid && (
            <p className="text-red-600 dark:text-red-400 text-xs mt-1">
              {t("ibanInvalid")}
            </p>
          )}
        </div>

        {/* Due day */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            {t("dueDay")}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t("dueDayHint")}
          </p>
          <select
            value={dueDay}
            onChange={(e) => {
              setDueDay(e.target.value);
              setSaved(false);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">{t("dueDayEndOfMonth")}</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}.
              </option>
            ))}
          </select>
        </div>

        {/* Debtor disclosure threshold */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            {t("debtorThreshold")}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t("debtorThresholdHint")}
          </p>
          <input
            value={debtorThreshold}
            onChange={(e) => {
              setDebtorThreshold(e.target.value);
              setSaved(false);
            }}
            inputMode="decimal"
            placeholder={t("debtorThresholdOff")}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-right w-40"
          />
        </div>

        {/* Strategy */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            {t("strategy")}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t("strategyHint")}
          </p>
          <div className="space-y-2">
            {(["proportional", "priority_ordered"] as const).map((s) => (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={strategy === s}
                  onChange={() => {
                    setStrategy(s);
                    setSaved(false);
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {t(`strategy_${s}`)}
                  </span>
                  <span className="block text-gray-600 dark:text-gray-400">
                    {t(`strategy_${s}_hint`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Priority order */}
        {strategy === "priority_ordered" && (
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t("priorityOrder")}
            </label>
            <ul className="space-y-1">
              {order.map((slug, i) => (
                <li
                  key={slug}
                  className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {i + 1}. {tCat(slug as Parameters<typeof tCat>[0])}
                  </span>
                  <span className="flex gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
                      aria-label={t("moveUp")}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-30"
                      aria-label={t("moveDown")}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && error !== "load" && (
          <p className="text-red-600 dark:text-red-400 text-sm">
            {t("submitError")} ({error})
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm text-green-700 dark:text-green-400">
              {t("savedOk")}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !ibanValid}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

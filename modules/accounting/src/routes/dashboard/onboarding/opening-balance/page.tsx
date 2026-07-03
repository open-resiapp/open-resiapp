"use client";

// Opening-balance wizard (BYT-20260512-002 Phase 1).
// Domain invariant 6: banka + pokladnica = Σ FPÚO + Σ zálohy + výsledok
// minulých rokov. The rozdiel is shown live on every keystroke; posting
// requires the treasurer to explicitly confirm the korekcia when the
// rozdiel is non-zero. Amounts are entered in EUR and converted to
// integer cents on parse — no float math on money.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { parseCents as parseCentsBase, formatEur } from "@modules/accounting/src/lib/money";

interface UnitRow {
  id: string;
  name: string;
  flatNumber: string | null;
}

interface State {
  entityId: string;
  country: "sk" | "cz";
  year: number;
  alreadyPosted: boolean;
  units: UnitRow[];
}

// Opening balances allow debts (negative) and treat empty fields as 0.
const parseCents = (raw: string) =>
  parseCentsBase(raw, { allowNegative: true, emptyAsZero: true });

export default function OpeningBalancePage() {
  const t = useTranslations("Accounting.openingBalance");
  const router = useRouter();

  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [banka, setBanka] = useState("");
  const [pokladnica, setPokladnica] = useState("");
  const [unitValues, setUnitValues] = useState<
    Record<string, { fpuo: string; zalohy: string }>
  >({});
  const [confirmKorekcia, setConfirmKorekcia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounting/opening-balance")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: State) => {
        setState(data);
        setLoading(false);
      })
      .catch(() => {
        setError("load");
        setLoading(false);
      });
  }, []);

  const bankaCents = parseCents(banka);
  const pokladnicaCents = parseCents(pokladnica);

  const unitCents = useMemo(() => {
    if (!state) return [];
    return state.units.map((u) => {
      const v = unitValues[u.id] ?? { fpuo: "", zalohy: "" };
      return {
        unit: u,
        fpuoCents: parseCents(v.fpuo),
        zalohyCents: parseCents(v.zalohy),
      };
    });
  }, [state, unitValues]);

  const unitsValid = unitCents.every(
    (u) => u.fpuoCents !== null && u.zalohyCents !== null
  );
  const step1Valid =
    bankaCents !== null &&
    pokladnicaCents !== null &&
    bankaCents >= 0 &&
    pokladnicaCents >= 0;

  const totals = useMemo(() => {
    const fpuo = unitCents.reduce((s, u) => s + (u.fpuoCents ?? 0), 0);
    const zalohy = unitCents.reduce((s, u) => s + (u.zalohyCents ?? 0), 0);
    const assets = (bankaCents ?? 0) + (pokladnicaCents ?? 0);
    return { fpuo, zalohy, assets, rozdiel: assets - fpuo - zalohy };
  }, [unitCents, bankaCents, pokladnicaCents]);

  async function submit() {
    if (!state) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/opening-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: state.year,
          bankaCents,
          pokladnicaCents,
          unitBalances: unitCents.map((u) => ({
            unitEntityId: u.unit.id,
            fpuoCents: u.fpuoCents,
            zalohyCents: u.zalohyCents,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? String(res.status));
      }
      router.push("/accounting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }
  if (!state) {
    return (
      <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>
    );
  }
  if (state.alreadyPosted) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t("title")}
        </h1>
        <p className="text-gray-700 dark:text-gray-300">{t("alreadyPosted")}</p>
      </div>
    );
  }

  const inputClass =
    "w-36 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-right bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
        {t("title")}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {t("subtitle", { year: state.year })}
      </p>

      {/* Step indicator */}
      <ol className="flex gap-2 mb-6 text-sm">
        {[1, 2, 3].map((s) => (
          <li
            key={s}
            className={`px-3 py-1 rounded-full ${
              step === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
            }`}
          >
            {s}. {t(`step${s}` as "step1" | "step2" | "step3")}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <label className="flex items-center justify-between gap-4">
            <span className="text-gray-900 dark:text-gray-100">{t("banka")}</span>
            <input
              value={banka}
              onChange={(e) => setBanka(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-gray-900 dark:text-gray-100">{t("pokladnica")}</span>
            <input
              value={pokladnica}
              onChange={(e) => setPokladnica(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!step1Valid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t("unitsHint")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-4">{t("unit")}</th>
                  <th className="py-2 pr-4 text-right">{t("fpuoBalance")}</th>
                  <th className="py-2 text-right">{t("zalohyBalance")}</th>
                </tr>
              </thead>
              <tbody>
                {state.units.map((u) => {
                  const v = unitValues[u.id] ?? { fpuo: "", zalohy: "" };
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {u.flatNumber ?? u.name}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <input
                          value={v.fpuo}
                          onChange={(e) =>
                            setUnitValues((prev) => ({
                              ...prev,
                              [u.id]: { ...v, fpuo: e.target.value },
                            }))
                          }
                          placeholder={t("amountPlaceholder")}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <input
                          value={v.zalohy}
                          onChange={(e) =>
                            setUnitValues((prev) => ({
                              ...prev,
                              [u.id]: { ...v, zalohy: e.target.value },
                            }))
                          }
                          placeholder={t("amountPlaceholder")}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
            {t("negativeHint")}
          </p>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setStep(1)}
              className="px-5 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              {t("back")}
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!unitsValid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-3">
          <dl className="space-y-2 text-gray-900 dark:text-gray-100">
            <div className="flex justify-between">
              <dt>{t("assetsTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.assets)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t("fpuoTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.fpuo)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t("zalohyTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.zalohy)}</dd>
            </div>
            <div
              className={`flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 ${
                totals.rozdiel === 0
                  ? "text-green-700 dark:text-green-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
            >
              <dt className="font-semibold">{t("rozdiel")}</dt>
              <dd className="font-semibold">{formatEur(totals.rozdiel)}</dd>
            </div>
          </dl>

          {totals.rozdiel !== 0 && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-900 dark:text-amber-200">
              <p className="mb-3">{t("korekciaExplain")}</p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmKorekcia}
                  onChange={(e) => setConfirmKorekcia(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  {t("korekciaConfirm", {
                    amount: formatEur(Math.abs(totals.rozdiel)),
                  })}
                </span>
              </label>
            </div>
          )}

          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm">
              {t("submitError")} ({error})
            </p>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-5 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              {t("back")}
            </button>
            <button
              onClick={submit}
              disabled={
                submitting || (totals.rozdiel !== 0 && !confirmKorekcia)
              }
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

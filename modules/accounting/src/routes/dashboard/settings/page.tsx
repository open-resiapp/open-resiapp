"use client";

// Nastavenia a pre účtovníka (BYT-20261117-002 Phase 5; settings from
// BYT-20260512-002 Phase 1). Collection IBAN (MOD-97 validated client- AND
// server-side), due day, debtor publication, heat basic share, how a partial
// payment is split. Every save appends a new effective-from row — history
// stays auditable. Below: links for the accountant / audit.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Field, Input, LoadingBlock, PageHeader, Select } from "@/components/ui";
import { isValidIban } from "@modules/accounting/src/lib/iban";
import { parseCents, centsToInput } from "@modules/accounting/src/lib/money";
import ForAccountantLinks from "@modules/accounting/src/components/ForAccountantLinks";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

interface Settings {
  allocationStrategy: "proportional" | "priority_ordered";
  priorityOrder: string[];
  bankIban: string | null;
  dueDay: number | null;
  debtorDisclosureThresholdCents: number | null;
  debtorNamesEnabled: boolean;
  heatBasicSharePct: number | null;
  categorySlugs: string[];
  country: "sk" | "cz";
}

export default function AccountingSettingsPage() {
  const t = useTranslations("Accounting.settings");
  const tCat = useTranslations("Accounting.serviceCategories");
  const { canWrite } = useAccountingAccess();

  const [loaded, setLoaded] = useState(false);
  const [strategy, setStrategy] = useState<Settings["allocationStrategy"]>("proportional");
  const [order, setOrder] = useState<string[]>([]);
  const [iban, setIban] = useState("");
  const [dueDay, setDueDay] = useState<string>("");
  const [debtorThreshold, setDebtorThreshold] = useState<string>("");
  const [debtorNamesEnabled, setDebtorNamesEnabled] = useState(false);
  const [country, setCountry] = useState<"sk" | "cz">("sk");
  const [heatBasic, setHeatBasic] = useState<string>("");
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
        const rest = data.categorySlugs.filter((s) => !data.priorityOrder.includes(s));
        setOrder([...data.priorityOrder, ...rest]);
        setIban(data.bankIban ?? "");
        setDueDay(data.dueDay === null ? "" : String(data.dueDay));
        setDebtorThreshold(
          data.debtorDisclosureThresholdCents === null
            ? ""
            : centsToInput(data.debtorDisclosureThresholdCents)
        );
        setDebtorNamesEnabled(data.debtorNamesEnabled ?? false);
        setCountry(data.country ?? "sk");
        setHeatBasic(data.heatBasicSharePct === null ? "" : String(data.heatBasicSharePct));
        setLoaded(true);
      })
      .catch(() => setError("load"));
  }, []);

  const ibanValid = iban.trim() === "" || isValidIban(iban);
  const touch = () => setSaved(false);

  function move(index: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    touch();
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
          // SK-only §9 ods. 3 name disclosure (AC 425).
          debtorNamesEnabled: country === "sk" && debtorNamesEnabled,
          heatBasicSharePct: heatBasic.trim() === "" ? null : Number(heatBasic),
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

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {error === "load" ? (
        <p className="text-base text-ui-danger">{t("loadError")}</p>
      ) : !loaded ? (
        <LoadingBlock />
      ) : (
        <Card as="section" aria-label={t("formLabel")}>
          <fieldset disabled={!canWrite} className="space-y-6">
            <Field
              label={t("iban")}
              hint={t("ibanHint")}
              error={!ibanValid ? t("ibanInvalid") : undefined}
            >
              <Input
                value={iban}
                onChange={(e) => {
                  setIban(e.target.value);
                  touch();
                }}
                placeholder={t("ibanPlaceholder")}
                className="font-mono"
              />
            </Field>

            <Field label={t("dueDay")} hint={t("dueDayHint")}>
              <Select
                value={dueDay}
                onChange={(e) => {
                  setDueDay(e.target.value);
                  touch();
                }}
              >
                <option value="">{t("dueDayEndOfMonth")}</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}.
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("debtorThreshold")} hint={t("debtorThresholdHint")}>
              <Input
                value={debtorThreshold}
                onChange={(e) => {
                  setDebtorThreshold(e.target.value);
                  touch();
                }}
                inputMode="decimal"
                placeholder={t("debtorThresholdOff")}
                className="max-w-48"
              />
            </Field>

            {/* SK-only §9 ods. 3 owner-name disclosure (AC 425). Hidden on CZ —
                no statutory basis. */}
            {country === "sk" && (
              <div className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={debtorNamesEnabled}
                    onChange={(e) => {
                      setDebtorNamesEnabled(e.target.checked);
                      touch();
                    }}
                    className="mt-1 h-5 w-5"
                  />
                  <span className="text-base">
                    <span className="block font-medium text-ui-text">{t("debtorNames")}</span>
                    <span className="mt-0.5 block text-ui-text-muted">{t("debtorNamesHint")}</span>
                    <span className="mt-1 block font-medium text-ui-text">{t("debtorNamesWarning")}</span>
                  </span>
                </label>
              </div>
            )}

            <Field label={t("heatBasicShare")} hint={t("heatBasicShareHint")}>
              <div className="flex items-center gap-2">
                <Input
                  value={heatBasic}
                  onChange={(e) => {
                    setHeatBasic(e.target.value);
                    touch();
                  }}
                  inputMode="numeric"
                  placeholder={t("heatBasicShareDefault")}
                  className="max-w-24 text-right"
                />
                <span className="text-base text-ui-text-muted">%</span>
              </div>
            </Field>

            <fieldset>
              <legend className="text-base font-medium text-ui-text">{t("strategy")}</legend>
              <p className="mb-2 text-base text-ui-text-muted">{t("strategyHint")}</p>
              <div className="space-y-2">
                {(["proportional", "priority_ordered"] as const).map((s) => (
                  <label key={s} className="flex min-h-11 items-start gap-3 text-base">
                    <input
                      type="radio"
                      name="allocation-strategy"
                      checked={strategy === s}
                      onChange={() => {
                        setStrategy(s);
                        touch();
                      }}
                      className="mt-1 h-5 w-5"
                    />
                    <span>
                      <span className="font-medium text-ui-text">{t(`strategy_${s}`)}</span>
                      <span className="block text-ui-text-muted">{t(`strategy_${s}_hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {strategy === "priority_ordered" && (
              <div>
                <p className="mb-2 text-base font-medium text-ui-text">{t("priorityOrder")}</p>
                <ol className="space-y-1">
                  {order.map((slug, i) => (
                    <li
                      key={slug}
                      className="flex items-center justify-between gap-3 rounded-lg bg-ui-surface-muted px-3 py-1 text-base"
                    >
                      <span className="text-ui-text">
                        {i + 1}. {tCat(slug as Parameters<typeof tCat>[0])}
                      </span>
                      <span className="flex gap-1">
                        <Button
                          variant="ghost"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label={t("moveUp")}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => move(i, 1)}
                          disabled={i === order.length - 1}
                          aria-label={t("moveDown")}
                        >
                          ↓
                        </Button>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </fieldset>

          {error && error !== "load" && (
            <p role="alert" className="mt-4 text-base font-medium text-ui-danger">
              {t("submitError")} ({error})
            </p>
          )}

          {canWrite ? (
            <div className="mt-6 flex items-center justify-end gap-3">
              {saved && (
                <span role="status" className="text-base text-ui-success">
                  {t("savedOk")}
                </span>
              )}
              <Button onClick={save} loading={saving} disabled={!ibanValid}>
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          ) : (
            <p className="mt-6 text-base text-ui-text-muted">{t("readOnlyNote")}</p>
          )}
        </Card>
      )}

      <ForAccountantLinks />
    </div>
  );
}

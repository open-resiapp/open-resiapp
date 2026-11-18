"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import {
  planTransferAction,
  transferAction,
  type TransferActionInput,
} from "@/app/[locale]/(dashboard)/owners/lifecycle-actions";
import { add, isOne, rational, type Rational } from "@/lib/rational";
import {
  TRANSFER_KINDS,
  todayIso,
  type ImpactPlan,
  type TransferKind,
  type UnitOwnerPeriod,
} from "@/lib/ownership";
import ImpactSummaryDialog from "./ImpactSummaryDialog";

// BYT-20261118-007 §3 — "Zmena vlastníka" wizard: 1 who leaves, 2 who comes
// (existing person or a new owner record) with shares — live 1/1 check,
// 3 date + kind + note, then the impact summary. One primary button per step.

interface BuyerRow {
  key: string;
  userId: string | null; // null = new owner record
  name: string;
  num: string;
  den: string;
}

export interface PersonOption {
  id: string;
  name: string;
}

interface Props {
  unitId: string;
  unitLabel: string;
  currentOwners: UnitOwnerPeriod[];
  people: PersonOption[];
  onClose: () => void;
}

function toInt(s: string): number {
  return /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN;
}

export default function TransferDialog({ unitId, unitLabel, currentOwners, people, onClose }: Props) {
  const t = useTranslations("OwnerLifecycle");
  const router = useRouter();
  const owners = currentOwners.filter((o) => o.role === "owner" && o.validTo === null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sellers, setSellers] = useState<string[]>(owners.length === 1 ? [owners[0].userId] : []);
  const [buyers, setBuyers] = useState<BuyerRow[]>([]);
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [kind, setKind] = useState<TransferKind>("sale");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<ImpactPlan | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remaining = owners.filter((o) => !sellers.includes(o.userId));
  const sum: Rational | null = useMemo(() => {
    try {
      let acc = rational(0, 1);
      for (const o of remaining) acc = add(acc, rational(o.shareNum, o.shareDen));
      for (const b of buyers) {
        const n = toInt(b.num);
        const d = toInt(b.den);
        if (!(n > 0 && d > 0 && n <= d)) return null;
        acc = add(acc, rational(n, d));
      }
      return acc;
    } catch {
      return null;
    }
  }, [remaining, buyers]);
  const sumOk = sum !== null && isOne(sum);
  const pickable = people.filter(
    (p) => !remaining.some((o) => o.userId === p.id) && !buyers.some((b) => b.userId === p.id)
  );

  function addExisting() {
    const p = people.find((x) => x.id === pick);
    if (!p) return;
    setBuyers((b) => [...b, { key: p.id, userId: p.id, name: p.name, num: "1", den: "1" }]);
    setPick("");
  }
  function addNew() {
    const name = newName.trim();
    if (!name) return;
    setBuyers((b) => [...b, { key: `new-${Date.now()}`, userId: null, name, num: "1", den: "1" }]);
    setNewName("");
  }
  function updateBuyer(key: string, patch: Partial<BuyerRow>) {
    setBuyers((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function input(): TransferActionInput {
    return {
      unitId,
      sellerUserIds: sellers,
      buyers: buyers
        .filter((b) => b.userId)
        .map((b) => ({ userId: b.userId!, shareNum: toInt(b.num), shareDen: toInt(b.den) })),
      newBuyers: buyers
        .filter((b) => !b.userId)
        .map((b) => ({ name: b.name, shareNum: toInt(b.num), shareDen: toInt(b.den) })),
      date,
      kind,
      note,
    };
  }

  async function preview() {
    setBusy(true);
    setError("");
    const r = await planTransferAction(input());
    setBusy(false);
    if (!r.ok) {
      setError(t(`errors.${r.error}`));
      return;
    }
    setPlan(r.plan);
    setShowPlan(true);
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError("");
    const r = await transferAction(input(), plan.hash);
    setBusy(false);
    if (!r.ok) {
      if (r.plan) setPlan(r.plan);
      setError(t(`errors.${r.error}`));
      return;
    }
    onClose();
    router.refresh();
  }

  const footer =
    step === 1 ? (
      <>
        <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
        <Button onClick={() => setStep(2)} disabled={sellers.length === 0}>{t("next")}</Button>
      </>
    ) : step === 2 ? (
      <>
        <Button variant="secondary" onClick={() => setStep(1)}>{t("back")}</Button>
        <Button onClick={() => setStep(3)} disabled={!sumOk}>{t("next")}</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => setStep(2)}>{t("back")}</Button>
        <Button onClick={() => void preview()} loading={busy} disabled={!date}>{t("transferPreview")}</Button>
      </>
    );

  return (
    <>
      <Modal open={!showPlan} onClose={onClose} title={t("transferTitle", { unit: unitLabel })} footer={footer}>
        <div className="space-y-4 text-base">
          <p className="text-ui-text-muted">{t("transferStep", { step, total: 3 })}</p>
          {error && (
            <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
              {error}
            </p>
          )}

          {step === 1 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold text-ui-text">{t("transferWhoLeaves")}</legend>
              {owners.map((o) => (
                <label key={o.membershipId} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={sellers.includes(o.userId)}
                    onChange={(e) =>
                      setSellers((s) => (e.target.checked ? [...s, o.userId] : s.filter((x) => x !== o.userId)))
                    }
                  />
                  <span className="text-ui-text">
                    {o.name} · {o.shareNum}/{o.shareDen}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-ui-text">{t("transferWhoComes")}</h3>
              {remaining.length > 0 && (
                <p className="text-ui-text-muted">
                  {t("transferRemaining", {
                    names: remaining.map((o) => `${o.name} (${o.shareNum}/${o.shareDen})`).join(", "),
                  })}
                </p>
              )}
              <ul className="space-y-3">
                {buyers.map((b) => (
                  <li key={b.key} className="rounded-lg border border-ui-border p-3">
                    <p className="mb-2 text-ui-text">
                      {b.name}
                      {b.userId ? "" : ` · ${t("newOwnerChip")}`}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label={t("shareNum")} htmlFor={`num-${b.key}`}>
                        <Input id={`num-${b.key}`} inputMode="numeric" className="w-24" value={b.num} onChange={(e) => updateBuyer(b.key, { num: e.target.value })} />
                      </Field>
                      <Field label={t("shareDen")} htmlFor={`den-${b.key}`}>
                        <Input id={`den-${b.key}`} inputMode="numeric" className="w-24" value={b.den} onChange={(e) => updateBuyer(b.key, { den: e.target.value })} />
                      </Field>
                      <Button variant="ghost" onClick={() => setBuyers((l) => l.filter((x) => x.key !== b.key))}>
                        {t("removeBuyer")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("pickExisting")} htmlFor="transfer-pick">
                  <Select id="transfer-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">{t("pickPlaceholder")}</option>
                    {pickable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Button variant="secondary" onClick={addExisting} disabled={!pick}>{t("addBuyer")}</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("newOwnerName")} htmlFor="transfer-new">
                  <Input id="transfer-new" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </Field>
                <Button variant="secondary" onClick={addNew} disabled={!newName.trim()}>{t("addNewOwner")}</Button>
              </div>
              <p role="status" className={sumOk ? "text-ui-success" : "text-ui-warning"}>
                {sum
                  ? t("shareSum", { sum: `${sum.num}/${sum.den}` })
                  : t("shareSumInvalid")}
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <Field label={t("transferDate")} htmlFor="transfer-date" hint={t("transferDateHint")}>
                <Input id="transfer-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={t("transferKind")} htmlFor="transfer-kind">
                <Select id="transfer-kind" value={kind} onChange={(e) => setKind(e.target.value as TransferKind)}>
                  {TRANSFER_KINDS.map((k) => (
                    <option key={k} value={k}>{t(`kinds.${k}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("transferNote")} htmlFor="transfer-note">
                <Textarea id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ImpactSummaryDialog
        open={showPlan}
        title={t("transferTitle", { unit: unitLabel })}
        plan={plan}
        confirmLabel={t("transferConfirm")}
        loading={busy}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setShowPlan(false)}
      />
    </>
  );
}

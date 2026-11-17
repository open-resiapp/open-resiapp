"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Icon, Input, Modal, Select } from "@/components/ui";
import { createOwnerAction } from "@/app/[locale]/(dashboard)/owners/actions";
import type { CreateOwnerErrorCode, UnitOption } from "@/lib/owners-board";
import { add, gt, ONE, rational, sub, type Rational } from "@/lib/rational";
import type { UserRole } from "@/types";

const ROLE_OPTIONS: UserRole[] = ["owner", "tenant", "vote_counter", "caretaker", "admin"];

export interface CreatedOwner {
  id: string;
  name: string;
  email: string | null;
}

interface AddOwnerModalProps {
  units: UnitOption[];
  onClose: () => void;
  /** Fired once the record exists (caller refreshes server data). */
  onCreated: () => void;
  /** Next step chosen on the success screen. */
  onInvite: (owner: CreatedOwner, mode: "email" | "qr") => void;
  /** "Ďalšie možnosti" → generic registration link (InvitationModal). */
  onGenericLink: () => void;
}

function sumShares(owners: UnitOption["owners"]): Rational {
  return owners.reduce<Rational>((acc, o) => add(acc, rational(o.shareNum, o.shareDen)), rational(0, 1));
}

/** Remaining share of a unit, or 1/2 when it is already fully owned (new co-owner). */
function suggestedShare(unit: UnitOption | undefined): { num: string; den: string } {
  if (!unit || unit.owners.length === 0) return { num: "1", den: "1" };
  const rest = sub(ONE, sumShares(unit.owners));
  if (rest.num > 0n) return { num: rest.num.toString(), den: rest.den.toString() };
  return { num: "1", den: "2" };
}

function formatShare(num: number, den: number) {
  return `${num}/${den}`;
}

export default function AddOwnerModal({
  units,
  onClose,
  onCreated,
  onInvite,
  onGenericLink,
}: AddOwnerModalProps) {
  const t = useTranslations("Owners.board");
  const tOwners = useTranslations("Owners");
  const tCommon = useTranslations("Common");

  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [shareNum, setShareNum] = useState("1");
  const [shareDen, setShareDen] = useState("1");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("owner");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CreateOwnerErrorCode | null>(null);
  const [created, setCreated] = useState<CreatedOwner | null>(null);

  const unit = units.find((u) => u.id === unitId);

  const overShare = useMemo(() => {
    if (!unit || unit.owners.length === 0) return false;
    const n = Number(shareNum);
    const d = Number(shareDen);
    if (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0) return false;
    return gt(add(sumShares(unit.owners), rational(n, d)), ONE);
  }, [unit, shareNum, shareDen]);

  function chooseUnit(id: string) {
    setUnitId(id);
    const s = suggestedShare(units.find((u) => u.id === id));
    setShareNum(s.num);
    setShareDen(s.den);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(shareNum);
    const d = Number(shareDen);
    if (!name.trim()) return setError("name_required");
    if (role === "owner" && !unitId) return setError("unit_required");
    // The ownership share applies to owners only; other roles get none.
    const sendsShare = role === "owner" && !!unitId;
    if (sendsShare && (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0 || n > d)) {
      return setError("invalid_share");
    }
    setSaving(true);
    const res = await createOwnerAction({
      name: name.trim(),
      email: email.trim(),
      unitId,
      shareNum: sendsShare ? n : 1,
      shareDen: sendsShare ? d : 1,
      role,
    }).catch(() => ({ ok: false as const, error: "failed" as const }));
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreated({ id: res.id, name: name.trim(), email: email.trim() || null });
    onCreated();
  }

  const roleLabels: Record<UserRole, string> = {
    admin: tOwners("roleAdmin"),
    owner: tOwners("roleOwner"),
    tenant: tOwners("roleTenant"),
    vote_counter: tOwners("roleVoteCounter"),
    caretaker: tOwners("roleCaretaker"),
  };

  if (created) {
    return (
      <Modal
        open
        onClose={onClose}
        title={t("createdTitle")}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t("done")}
          </Button>
        }
      >
        <div className="space-y-4">
          <p role="status">{t("createdBody", { name: created.name })}</p>
          <div className="flex flex-col gap-2">
            {created.email ? (
              <Button fullWidth onClick={() => onInvite(created, "email")}>
                <Icon name="mail" size={20} />
                {t("sendEmail")}
              </Button>
            ) : null}
            <Button
              fullWidth
              variant={created.email ? "secondary" : "primary"}
              onClick={() => onInvite(created, "qr")}
            >
              <Icon name="qr" size={20} />
              {t("printQr")}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const formId = "add-owner-form";
  const errorText = error ? t(`errors.${error}`) : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("addTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {t("create")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        {errorText && (
          <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
            {errorText}
          </p>
        )}

        <Field label={t("nameLabel")} required error={error === "name_required" ? errorText : undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={255}
            data-autofocus=""
          />
        </Field>

        <Field
          label={t("flatLabel")}
          required={role === "owner"}
          error={error === "unit_required" || error === "unit_not_found" ? errorText : undefined}
          hint={
            unit && unit.owners.length > 0
              ? t("unitOwners", {
                  owners: unit.owners
                    .map((o) => `${o.name} (${formatShare(o.shareNum, o.shareDen)})`)
                    .join(", "),
                })
              : undefined
          }
        >
          <Select value={unitId} onChange={(e) => chooseUnit(e.target.value)}>
            <option value="">{role === "owner" ? t("flatPlaceholder") : t("flatNone")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.flatNumber}
                {u.entranceName ? ` (${u.entranceName})` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {unitId && role === "owner" ? (
          <fieldset className="space-y-1.5">
            <legend className="text-base font-medium text-ui-text">{t("shareLabel")}</legend>
            <p className="text-ui-text-muted">{t("shareHint")}</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={shareNum}
                onChange={(e) => setShareNum(e.target.value)}
                aria-label={t("shareNum")}
                invalid={error === "invalid_share"}
                className="w-24 text-center"
              />
              <span aria-hidden="true" className="text-lg text-ui-text-muted">
                /
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={shareDen}
                onChange={(e) => setShareDen(e.target.value)}
                aria-label={t("shareDen")}
                invalid={error === "invalid_share"}
                className="w-24 text-center"
              />
            </div>
            {overShare ? (
              <p className="text-ui-warning" role="status">
                {t("shareSumWarning")}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <Field
          label={t("emailLabel")}
          hint={t("emailHint")}
          error={error === "invalid_email" || error === "email_taken" ? errorText : undefined}
        >
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <div className="border-t border-ui-border pt-2">
          <Button
            variant="ghost"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            aria-controls="add-owner-more"
            className="-ml-2"
          >
            <Icon name={showMore ? "chevronDown" : "chevronRight"} size={20} />
            {t("moreOptions")}
          </Button>
          {showMore ? (
            <div id="add-owner-more" className="mt-2 space-y-4">
              <Field label={t("roleLabel")} hint={t("roleHint")}>
                <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {roleLabels[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary" fullWidth onClick={onGenericLink}>
                <Icon name="link" size={20} />
                {t("genericLink")}
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Input, Select } from "@/components/ui";
import type { OwnerRow, UnitOption } from "@/lib/owners-board";
import type { UserRole } from "@/types";
import { useOptionalShell } from "@/components/layout/ShellContext";
import { roleOptionsFor } from "@/lib/role-options";

export interface ShareWarning {
  flatId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

interface ShareInput {
  num: string;
  den: string;
}


/**
 * Edit name, contact, role, flats and per-flat owner share. Request unchanged:
 * PATCH /api/users/[id] {name, email, phone, role, flatIds, shares}.
 */
export default function OwnerEditForm({
  owner,
  units,
  onCancel,
  onSaved,
}: {
  owner: OwnerRow;
  units: UnitOption[];
  onCancel: () => void;
  onSaved: (warnings: ShareWarning[]) => void;
}) {
  const t = useTranslations("Owners");
  const tCommon = useTranslations("Common");
  const isShell = owner.status === "no_account" || owner.status === "invited";

  const [name, setName] = useState(owner.name);
  const [email, setEmail] = useState(owner.email ?? "");
  const [phone, setPhone] = useState(owner.phone ?? "");
  const [role, setRole] = useState<UserRole>(owner.role);
  // BYT-20261118-020: template-aware list; the stored role stays selectable.
  const roleOptions = roleOptionsFor(useOptionalShell()?.community?.templateSlug, {
    includeAdmin: true,
    current: owner.role,
  });
  const [flatIds, setFlatIds] = useState<string[]>(owner.flats.map((f) => f.unitId));
  const [shares, setShares] = useState<Record<string, ShareInput>>(
    Object.fromEntries(owner.flats.map((f) => [f.unitId, { num: String(f.shareNum), den: String(f.shareDen) }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleFlat(flatId: string) {
    setFlatIds((prev) => (prev.includes(flatId) ? prev.filter((id) => id !== flatId) : [...prev, flatId]));
    // Default new selections to a sole-owner 1/1 share.
    setShares((prev) => (prev[flatId] ? prev : { ...prev, [flatId]: { num: "1", den: "1" } }));
  }

  function setShare(flatId: string, field: keyof ShareInput, value: string) {
    setShares((prev) => ({
      ...prev,
      [flatId]: { num: prev[flatId]?.num ?? "1", den: prev[flatId]?.den ?? "1", [field]: value },
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const shareList: Array<{ flatId: string; num: number; den: number }> = [];
    for (const flatId of flatIds) {
      const s = shares[flatId] ?? { num: "1", den: "1" };
      const num = Number(s.num);
      const den = Number(s.den);
      if (!Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) {
        setError(t("invalidShare"));
        setSaving(false);
        return;
      }
      shareList.push({ flatId, num, den });
    }

    const body: Record<string, unknown> = {
      name,
      phone: phone || null,
      role,
      flatIds,
      shares: shareList,
    };
    // An owner record without login may have no e-mail; sending "" would
    // store an empty string, so leave the field untouched instead.
    if (!(isShell && email.trim() === "")) body.email = email;

    const res = await fetch(`/api/users/${owner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // The API returns a stable code ({ error: CODE }) — never show it raw.
      const key = `apiErrors.${data.error}`;
      setError(typeof data.error === "string" && t.has(key) ? t(key) : tCommon("saveFailed"));
      setSaving(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    onSaved(data.shareWarnings ?? []);
  }

  const roleLabels: Record<UserRole, string> = {
    admin: t("roleAdmin"),
    owner: t("roleOwner"),
    tenant: t("roleTenant"),
    vote_counter: t("roleVoteCounter"),
    caretaker: t("roleCaretaker"),
    member: t("roleMember"),
    accountant: t("roleAccountant"),
    spravca: t("roleSpravca"),
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("nameLabel")} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("emailLabel")} required={!isShell}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("phoneLabel")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t("roleLabel")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-base font-medium text-ui-text">{t("flatsLabel")}</legend>
        <div className="max-h-72 divide-y divide-ui-border overflow-y-auto rounded-lg border border-ui-border-strong">
          {units.length === 0 ? (
            <p className="px-4 py-3 text-ui-text-muted">{t("noFlat")}</p>
          ) : (
            units.map((f) => {
              const checked = flatIds.includes(f.id);
              const share = shares[f.id] ?? { num: "1", den: "1" };
              return (
                <div key={f.id} className="px-4 py-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFlat(f.id)}
                      className="h-5 w-5 shrink-0"
                    />
                    <span className="min-w-0 break-words text-ui-text">
                      {t("flatLabel")} {f.flatNumber}
                      {f.entranceName ? ` (${f.entranceName})` : ""}
                    </span>
                  </label>
                  {checked && (
                    <div className="mb-2 ml-8 flex flex-wrap items-center gap-2">
                      <span className="text-ui-text-muted">{t("ownerShareLabel")}</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={share.num}
                        onChange={(e) => setShare(f.id, "num", e.target.value)}
                        aria-label={t("shareNumeratorLabel")}
                        className="w-20 text-center"
                      />
                      <span aria-hidden="true" className="text-ui-text-muted">
                        /
                      </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={share.den}
                        onChange={(e) => setShare(f.id, "den", e.target.value)}
                        aria-label={t("shareDenominatorLabel")}
                        className="w-20 text-center"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? tCommon("saving") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { VotingMethod } from "@/types";
import { Badge, Button, Card, Field, Icon, Input, Textarea } from "@/components/ui";
import { useOptionalShell } from "@/components/layout/ShellContext";
import { getLegalCopy } from "@/lib/legal-copy";
import { normalizeVotingMethod, type CanonicalVotingMethod } from "@/lib/voting-method";
import {
  STATUTORY_LEAD_DAYS,
  validateNoticeLeadSetting,
} from "@modules/voting/src/workflow/notice";
import Notice, { type NoticeState } from "./Notice";

interface VotingSettingsTabProps {
  canEdit: boolean;
  /** Stored voting settings, resolved by the server page. */
  initialMethod: string;
  initialLegalNotice: string | null;
  /**
   * BYT-20261118-020: stanovy notice lead time (entities.data.notice_lead_days).
   * `undefined` = the page does not load / persist it yet → section hidden,
   * so the field can never be a silent no-op.
   */
  initialNoticeLeadDays?: number | null;
}

// Radio value = the value PATCHed to /api/building. The HOA trio keeps its
// legacy names (what every existing install stores); the member-scoped
// methods only exist as canonical names.
const methods: {
  value: VotingMethod | CanonicalVotingMethod;
  canonical: CanonicalVotingMethod;
  labelKey: string;
  descKey: string;
}[] = [
  { value: "per_share", canonical: "weighted_by_share", labelKey: "votingMethodPerShare", descKey: "votingMethodPerShareDesc" },
  { value: "per_flat", canonical: "one_per_unit", labelKey: "votingMethodPerFlat", descKey: "votingMethodPerFlatDesc" },
  { value: "per_area", canonical: "per_area", labelKey: "votingMethodPerArea", descKey: "votingMethodPerAreaDesc" },
  { value: "one_per_member", canonical: "one_per_member", labelKey: "votingMethodPerMember", descKey: "votingMethodPerMemberDesc" },
  { value: "custom_weight", canonical: "custom_weight", labelKey: "votingMethodCustomWeight", descKey: "votingMethodCustomWeightDesc" },
];

// Stored values may use the canonical or the legacy names; show them on the
// radio that means the same thing.
function toRadioValue(stored: string): string {
  const canonical = normalizeVotingMethod(stored);
  return methods.find((m) => m.canonical === canonical)?.value ?? stored;
}

const NOTICE_SETTING_ERROR_KEYS = {
  NOTICE_LEAD_SETTING_INVALID: "noticeLeadErrorInvalid",
  NOTICE_LEAD_SETTING_BELOW_STATUTORY: "noticeLeadErrorBelowStatutory",
} as const;

// Error codes returned by PATCH /api/building (src/app/api/building/route.ts).
const API_ERROR_KEYS: Record<string, string> = {
  ...NOTICE_SETTING_ERROR_KEYS,
  VOTING_METHOD_NOT_ALLOWED: "votingMethodNotAllowedError",
};

class PatchError extends Error {
  constructor(
    readonly code: string | null,
    readonly minDays?: number
  ) {
    super(code ?? "PATCH_FAILED");
  }
}

export default function VotingSettingsTab({
  canEdit,
  initialMethod,
  initialLegalNotice,
  initialNoticeLeadDays,
}: VotingSettingsTabProps) {
  const t = useTranslations("Settings");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const router = useRouter();
  const shell = useOptionalShell();
  // Statute-driven: SK zák. 182/1993 §14 ods. 3 counts votes per unit, so an
  // SVB never sees "one member = one vote"; a bytové družstvo (§240 Obch.
  // zák. / §755 ZOK) never sees the per-unit methods.
  const legal = getLegalCopy(shell?.community?.templateSlug, shell?.community?.country);
  const defaultRadio = toRadioValue(legal.defaultVotingMethod);
  const startMethod = toRadioValue(initialMethod || legal.defaultVotingMethod);
  const visibleMethods = methods.filter(
    (m) => legal.votingMethods.includes(m.canonical) || m.value === startMethod
  );
  const [currentMethod, setCurrentMethod] = useState<string>(startMethod);
  const [selectedMethod, setSelectedMethod] = useState<string>(startMethod);
  const [legalNotice, setLegalNotice] = useState(initialLegalNotice ?? "");
  const [savedLegalNotice, setSavedLegalNotice] = useState(initialLegalNotice ?? "");
  const [saving, setSaving] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);
  const [missingAreas, setMissingAreas] = useState(false);
  const [message, setMessage] = useState<NoticeState>(null);
  const isAllowed = (value: string) =>
    legal.votingMethods.includes(normalizeVotingMethod(value)) &&
    methods.some((m) => m.value === value);

  // Stanovy notice lead time (empty input = statutory minimum only).
  const showNoticeLead = initialNoticeLeadDays !== undefined;
  const statutoryLead = STATUTORY_LEAD_DAYS[legal.regime][legal.country];
  const savedLeadText = initialNoticeLeadDays == null ? "" : String(initialNoticeLeadDays);
  const [savedLead, setSavedLead] = useState(savedLeadText);
  const [leadInput, setLeadInput] = useState(savedLeadText);
  const [savingLead, setSavingLead] = useState(false);
  const leadValue = leadInput.trim() === "" ? null : Number(leadInput);
  const leadError = validateNoticeLeadSetting(legal.country, legal.regime, leadValue);

  // The flat list is only needed to warn about missing areas when the
  // "by area" method is chosen — fetch it lazily, once.
  const [areasChecked, setAreasChecked] = useState(false);
  useEffect(() => {
    if (selectedMethod !== "per_area" || areasChecked) return;
    setAreasChecked(true);
    fetch("/api/flats")
      .then((r) => (r.ok ? r.json() : []))
      .then((flats: { area: number | null }[]) => setMissingAreas(flats.some((f) => f.area === null)))
      .catch(() => {});
  }, [selectedMethod, areasChecked]);

  const hasChanges = selectedMethod !== currentMethod && isAllowed(selectedMethod);
  const hasNoticeChanges = legalNotice !== savedLegalNotice;

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/building", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { error?: unknown; minDays?: unknown }
        | null;
      throw new PatchError(
        typeof data?.error === "string" ? data.error : null,
        typeof data?.minDays === "number" ? data.minDays : undefined
      );
    }
  };

  // Server-side code → catalog entry; unknown codes fall back to `fallbackKey`.
  const errorText = (err: unknown, fallbackKey: string) => {
    if (err instanceof PatchError && err.code && API_ERROR_KEYS[err.code]) {
      return t(API_ERROR_KEYS[err.code], { days: err.minDays ?? 0 });
    }
    return t(fallbackKey);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await patch({ votingMethod: selectedMethod });
      setCurrentMethod(selectedMethod);
      setMessage({ type: "success", text: t("votingMethodSaved") });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "votingMethodSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLead = async () => {
    if (leadError) return;
    setSavingLead(true);
    setMessage(null);
    try {
      await patch({ noticeLeadDays: leadValue });
      setSavedLead(leadInput.trim());
      setMessage({ type: "success", text: t("noticeLeadSaved") });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: errorText(err, "noticeLeadSaveFailed") });
    } finally {
      setSavingLead(false);
    }
  };

  const handleSaveNotice = async () => {
    setSavingNotice(true);
    setMessage(null);
    try {
      await patch({ legalNotice: legalNotice || null });
      setSavedLegalNotice(legalNotice);
      setMessage({ type: "success", text: t("legalNoticeSaved") });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: t("legalNoticeSaveFailed") });
    } finally {
      setSavingNotice(false);
    }
  };

  return (
    <Card as="section" padding="lg" aria-labelledby="voting-heading" className="space-y-5">
      <div>
        <h2 id="voting-heading" className="text-xl font-semibold text-ui-text">
          {t("votingSettings")}
        </h2>
        <p className="mt-1 text-base text-ui-text-muted">{th("votingIntro")}</p>
      </div>

      <Notice state={message} />

      <fieldset className="space-y-3">
        <legend className="sr-only">{t("votingMethod")}</legend>
        {visibleMethods.map((method) => {
          const selected = selectedMethod === method.value;
          const allowed = isAllowed(method.value);
          return (
            <label
              key={method.value}
              className={`flex min-h-14 items-start gap-3 rounded-lg border p-4 transition-colors ${
                selected ? "border-ui-primary bg-ui-surface-muted" : "border-ui-border hover:border-ui-border-strong"
              } ${canEdit ? "cursor-pointer" : "cursor-default"}`}
            >
              <input
                type="radio"
                name="votingMethod"
                value={method.value}
                checked={selected}
                onChange={() => canEdit && allowed && setSelectedMethod(method.value)}
                disabled={!canEdit || !allowed}
                className="mt-1 h-5 w-5 shrink-0 accent-ui-primary"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ui-text">{t(method.labelKey)}</span>
                  {method.value === defaultRadio ? <Badge tone="info">{th("defaultBadge")}</Badge> : null}
                  {!allowed ? <Badge tone="warning">{t("votingMethodNotAllowed")}</Badge> : null}
                </span>
                <span className="mt-0.5 block text-base text-ui-text-muted">{t(method.descKey)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {selectedMethod === "per_area" && missingAreas ? (
        <p className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 p-3 text-base text-ui-text">
          {t("missingAreaWarning")}
        </p>
      ) : null}

      {!isAllowed(currentMethod) ? (
        <p className="rounded-lg border border-ui-warning/40 bg-ui-warning/10 p-3 text-base text-ui-text">
          {t("votingMethodNotAllowedHint")}
        </p>
      ) : null}

      {canEdit && hasChanges ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSave} loading={saving}>
            {saving ? tc("saving") : tc("save")}
          </Button>
          <Button variant="secondary" onClick={() => setSelectedMethod(currentMethod)}>
            {tc("cancel")}
          </Button>
        </div>
      ) : null}

      {showNoticeLead ? (
        <div className="space-y-3 rounded-lg border border-ui-border p-4">
          <Field
            label={t("noticeLeadLabel")}
            hint={
              statutoryLead === null
                ? t("noticeLeadHintStanovy")
                : t("noticeLeadHintStatutory", { days: statutoryLead })
            }
            error={
              leadError
                ? t(NOTICE_SETTING_ERROR_KEYS[leadError.code], { days: leadError.minDays ?? 0 })
                : undefined
            }
          >
            <Input
              type="number"
              inputMode="numeric"
              min={statutoryLead ?? 0}
              step={1}
              value={leadInput}
              onChange={(e) => canEdit && setLeadInput(e.target.value)}
              disabled={!canEdit}
              placeholder={statutoryLead === null ? "" : String(statutoryLead)}
            />
          </Field>
          {canEdit && leadInput.trim() !== savedLead ? (
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSaveLead} loading={savingLead} disabled={!!leadError}>
                {savingLead ? tc("saving") : tc("save")}
              </Button>
              <Button variant="secondary" onClick={() => setLeadInput(savedLead)}>
                {tc("cancel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Rarely changed: legal notice printed on voting documents. */}
      <details className="group rounded-lg border border-ui-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-base font-medium text-ui-text [&::-webkit-details-marker]:hidden">
          {th("moreOptions")}
          <Icon name="chevronDown" size={20} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-ui-border p-4">
          <Field label={t("legalNoticeLabel")} hint={th("legalNoticeHint")}>
            <Textarea
              value={legalNotice}
              onChange={(e) => canEdit && setLegalNotice(e.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder={t("legalNoticePlaceholder")}
            />
          </Field>
          {canEdit && hasNoticeChanges ? (
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSaveNotice} loading={savingNotice}>
                {savingNotice ? tc("saving") : tc("save")}
              </Button>
              <Button variant="secondary" onClick={() => setLegalNotice(savedLegalNotice)}>
                {tc("cancel")}
              </Button>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { VotingMethod } from "@/types";
import { Badge, Button, Card, Field, Icon, Textarea } from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";

interface VotingSettingsTabProps {
  canEdit: boolean;
  /** Stored voting settings, resolved by the server page. */
  initialMethod: string;
  initialLegalNotice: string | null;
}

const methods: { value: VotingMethod; labelKey: string; descKey: string }[] = [
  { value: "per_share", labelKey: "votingMethodPerShare", descKey: "votingMethodPerShareDesc" },
  { value: "per_flat", labelKey: "votingMethodPerFlat", descKey: "votingMethodPerFlatDesc" },
  { value: "per_area", labelKey: "votingMethodPerArea", descKey: "votingMethodPerAreaDesc" },
];

// Both the Slovak (zák. 182/1993) and Czech (SVJ) default is "by co-ownership
// share". Stored values may use the canonical names; show them on the radio
// that means the same thing.
const DEFAULT_METHOD: VotingMethod = "per_share";
function toRadioValue(stored: string): string {
  if (stored === "weighted_by_share") return "per_share";
  if (stored === "one_per_unit") return "per_flat";
  return stored;
}

export default function VotingSettingsTab({ canEdit, initialMethod, initialLegalNotice }: VotingSettingsTabProps) {
  const t = useTranslations("Settings");
  const th = useTranslations("SettingsHub");
  const tc = useTranslations("Common");
  const router = useRouter();
  const startMethod = toRadioValue(initialMethod || DEFAULT_METHOD);
  const [currentMethod, setCurrentMethod] = useState<string>(startMethod);
  const [selectedMethod, setSelectedMethod] = useState<string>(startMethod);
  const [legalNotice, setLegalNotice] = useState(initialLegalNotice ?? "");
  const [savedLegalNotice, setSavedLegalNotice] = useState(initialLegalNotice ?? "");
  const [saving, setSaving] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);
  const [missingAreas, setMissingAreas] = useState(false);
  const [message, setMessage] = useState<NoticeState>(null);

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

  const hasChanges = selectedMethod !== currentMethod;
  const hasNoticeChanges = legalNotice !== savedLegalNotice;

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/building", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await patch({ votingMethod: selectedMethod });
      setCurrentMethod(selectedMethod);
      setMessage({ type: "success", text: t("votingMethodSaved") });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: t("votingMethodSaveFailed") });
    } finally {
      setSaving(false);
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
        {methods.map((method) => {
          const selected = selectedMethod === method.value;
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
                onChange={() => canEdit && setSelectedMethod(method.value)}
                disabled={!canEdit}
                className="mt-1 h-5 w-5 shrink-0 accent-ui-primary"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ui-text">{t(method.labelKey)}</span>
                  {method.value === DEFAULT_METHOD ? <Badge tone="info">{th("defaultBadge")}</Badge> : null}
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

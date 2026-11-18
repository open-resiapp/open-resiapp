"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button, Card, Field, Icon, Input, Textarea, cn } from "@/components/ui";
import { focusRing, focusWithinRing } from "@/components/ui/cn";
import { useRouter } from "@/i18n/navigation";

import {
  checkPhoto,
  MAX_PHOTOS,
  TITLE_MAX,
  type FaultVisibility,
  type LocationKind,
} from "../engine/transitions";
import { useFaultApi } from "./useFaultApi";

// Owner report flow (BYT-20261118-004): ≤ 3 screens on a phone —
// 1 Čo sa pokazilo? → 2 Kde? → 3 Skontrolovať a odoslať. One primary
// button per screen, 44 px targets, text-base.

export interface ReportLocation {
  id: string;
  kind: LocationKind;
  label: string;
  defaultVisibility: FaultVisibility;
}

type Step = 1 | 2 | 3;

export function ReportFlow({
  locations,
  preselectedId,
}: {
  locations: ReportLocation[];
  preselectedId: string | null;
}) {
  const t = useTranslations("Faults");
  const locale = useLocale();
  const router = useRouter();
  const { call, busy, error, setError } = useFaultApi();

  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [locationId, setLocationId] = useState<string | null>(preselectedId);
  const [locationNote, setLocationNote] = useState("");
  const [privateOnly, setPrivateOnly] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const location = locations.find((l) => l.id === locationId) ?? null;
  const visibility: FaultVisibility | null = location
    ? privateOnly
      ? "private"
      : location.defaultVisibility
    : null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...photos];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) {
        setError(t("errors.FAULT_TOO_MANY_PHOTOS"));
        break;
      }
      if (!checkPhoto({ type: f.type, size: f.size }).ok) {
        setError(t("errors.FAULT_PHOTO_INVALID"));
        continue;
      }
      next.push(f);
    }
    setPhotos(next);
  };

  const goStep2 = () => {
    const v = title.trim();
    if (!v) return setTitleError(t("errors.FAULT_TITLE_REQUIRED"));
    if (v.length > TITLE_MAX) return setTitleError(t("errors.FAULT_INVALID_INPUT"));
    setTitleError(null);
    setError(null);
    setStep(2);
  };

  const submit = async () => {
    if (!location || !visibility) return;
    const form = new FormData();
    form.set("title", title.trim());
    if (description.trim()) form.set("description", description.trim());
    form.set("locationEntityId", location.id);
    if (locationNote.trim()) form.set("locationNote", locationNote.trim());
    form.set("visibility", visibility);
    form.set("locale", locale);
    for (const p of photos) form.append("photos", p);
    const res = await call<{ id: string }>("/api/modules/faults", { method: "POST", body: form });
    if (res?.id) router.push(`/poruchy/${res.id}?nove=1`);
  };

  const visibilitySentence = (v: FaultVisibility) => t(`visibilityHint.${v}`);

  return (
    <div className="space-y-6">
      <p className="text-base text-ui-text-muted" aria-live="polite">
        {t("report.stepOf", { step, total: 3 })}
      </p>

      {step === 1 ? (
        <section className="space-y-5" aria-labelledby="fault-step-1">
          <h2 id="fault-step-1" className="text-xl font-semibold text-ui-text">
            {t("report.step1Title")}
          </h2>
          <Field label={t("report.titleLabel")} hint={t("report.titleHint")} error={titleError} required>
            <Input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t("report.descriptionLabel")} hint={t("report.descriptionHint")}>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <div className="space-y-3">
            <label
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ui-border-strong bg-ui-surface px-4 text-base font-medium text-ui-text hover:bg-ui-surface-muted",
                photos.length >= MAX_PHOTOS && "pointer-events-none opacity-50",
                focusWithinRing
              )}
            >
              <Icon name="upload" size={20} />
              {t("report.addPhoto")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={photos.length >= MAX_PHOTOS}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-base text-ui-text-muted">{t("report.photoHint", { max: MAX_PHOTOS })}</p>
            {photos.length > 0 ? (
              <ul className="space-y-2">
                {photos.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-ui-border px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-base">{p.name}</span>
                    <Button
                      variant="ghost"
                      onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                      aria-label={t("report.removePhotoNamed", { name: p.name })}
                    >
                      <Icon name="trash" size={20} />
                      {t("report.removePhoto")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? <p role="alert" className="text-base text-ui-danger">{error}</p> : null}
          <Button fullWidth size="lg" onClick={goStep2}>
            {t("report.next")}
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-5" aria-labelledby="fault-step-2">
          <h2 id="fault-step-2" className="text-xl font-semibold text-ui-text">
            {t("report.step2Title")}
          </h2>
          <ul className="space-y-2" role="list">
            {locations.map((l) => {
              const selected = l.id === locationId;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setLocationId(l.id);
                      setPrivateOnly(false);
                    }}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-base font-medium",
                      selected
                        ? "border-ui-primary bg-ui-primary/10 text-ui-text"
                        : "border-ui-border bg-ui-surface text-ui-text hover:bg-ui-surface-muted",
                      focusRing
                    )}
                  >
                    <Icon name={l.kind === "unit" ? "home" : "building"} size={22} />
                    <span className="flex-1">{l.label}</span>
                    {selected ? <Icon name="check" size={22} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <Field label={t("report.locationNoteLabel")} hint={t("report.locationNoteHint")}>
            <Input value={locationNote} maxLength={255} onChange={(e) => setLocationNote(e.target.value)} />
          </Field>
          {location && visibility ? (
            <Card padding="md" className="space-y-3">
              <p className="text-base text-ui-text">{visibilitySentence(visibility)}</p>
              {location.defaultVisibility !== "private" ? (
                <label className="flex min-h-11 items-center gap-3 text-base text-ui-text">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={privateOnly}
                    onChange={(e) => setPrivateOnly(e.target.checked)}
                  />
                  {t("report.privateOnly")}
                </label>
              ) : null}
            </Card>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t("report.back")}
            </Button>
            <Button size="lg" disabled={!location} onClick={() => setStep(3)}>
              {t("report.next")}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 && location && visibility ? (
        <section className="space-y-5" aria-labelledby="fault-step-3">
          <h2 id="fault-step-3" className="text-xl font-semibold text-ui-text">
            {t("report.step3Title")}
          </h2>
          <Card padding="md">
            <dl className="space-y-3 text-base">
              <div>
                <dt className="text-ui-text-muted">{t("report.titleLabel")}</dt>
                <dd className="font-medium break-words text-ui-text">{title.trim()}</dd>
              </div>
              {description.trim() ? (
                <div>
                  <dt className="text-ui-text-muted">{t("report.descriptionLabel")}</dt>
                  <dd className="whitespace-pre-line break-words text-ui-text">{description.trim()}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-ui-text-muted">{t("report.whereLabel")}</dt>
                <dd className="text-ui-text">
                  {location.label}
                  {locationNote.trim() ? ` — ${locationNote.trim()}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-ui-text-muted">{t("report.photosLabel")}</dt>
                <dd className="text-ui-text">{t("report.photoCount", { count: photos.length })}</dd>
              </div>
              <div>
                <dt className="text-ui-text-muted">{t("report.whoSeesLabel")}</dt>
                <dd className="text-ui-text">{visibilitySentence(visibility)}</dd>
              </div>
            </dl>
          </Card>
          {error ? <p role="alert" className="text-base text-ui-danger">{error}</p> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={busy}>
              {t("report.back")}
            </Button>
            <Button size="lg" loading={busy} onClick={submit}>
              {t("report.submit")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

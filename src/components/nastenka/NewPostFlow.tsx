"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useShell } from "@/components/layout/ShellContext";
import { Button, ButtonLink, Field, Icon, Input, Select, Textarea, type IconName } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { ALLOWED_DOCUMENT_MIME, MAX_DOCUMENT_SIZE } from "@/lib/documents";
import { withPrice, type CreateType } from "@/lib/feed";
import { ImportantCheckbox } from "./EditPostModal";
import FilePicker from "./FilePicker";

// One create flow for every feed item type (/board/novy). Step 1: pick the
// type (large labelled choices). Step 2: a short form per type, mapped onto
// the two existing APIs:
//   oznam   → POST /api/posts             (board notice)
//   udalost → POST /api/community/posts   type "event"
//   pomoc   → POST /api/community/posts   type "help_offer" | "help_request"
//   predaj  → POST /api/community/posts   type "sale" (price) | "free" (no price)

const TYPE_ICON: Record<CreateType, IconName> = {
  oznam: "megaphone",
  udalost: "calendar",
  pomoc: "heart",
  predaj: "wallet",
};

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";
const PHOTO_MAX = 5 * 1024 * 1024;

export default function NewPostFlow({
  allowedTypes,
  initialType,
  entrances,
}: {
  /** In display order; board members get "oznam" first. */
  allowedTypes: CreateType[];
  initialType: CreateType | null;
  /** Only passed when the building has more than one entrance. */
  entrances: { id: string; name: string }[];
}) {
  const t = useTranslations("Feed.create");
  const [type, setType] = useState<CreateType | null>(
    initialType ?? (allowedTypes.length === 1 ? allowedTypes[0] : null)
  );

  if (!type) {
    return (
      <fieldset>
        <legend className="mb-4 text-lg font-semibold text-ui-text">{t("chooseType")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {allowedTypes.map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setType(ct)}
              className="flex min-h-20 items-start gap-4 rounded-xl border border-ui-border-strong bg-ui-surface p-4 text-left hover:bg-ui-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ui-surface-muted text-ui-text">
                <Icon name={TYPE_ICON[ct]} size={26} />
              </span>
              <span>
                <span className="block text-lg font-semibold text-ui-text">{t(`type.${ct}.label`)}</span>
                <span className="block text-base text-ui-text-muted">{t(`type.${ct}.desc`)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-6">
          <ButtonLink href="/board" variant="ghost">
            {t("cancel")}
          </ButtonLink>
        </div>
      </fieldset>
    );
  }

  return (
    <TypeForm
      key={type}
      type={type}
      entrances={entrances}
      onChangeType={allowedTypes.length > 1 ? () => setType(null) : undefined}
    />
  );
}

function TypeForm({
  type,
  entrances,
  onChangeType,
}: {
  type: CreateType;
  entrances: { id: string; name: string }[];
  onChangeType?: () => void;
}) {
  const t = useTranslations("Feed.create");
  const router = useRouter();
  const { entities } = useShell();

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [important, setImportant] = useState(false);
  const [entranceId, setEntranceId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [place, setPlace] = useState("");
  const [helpKind, setHelpKind] = useState<"help_offer" | "help_request" | null>(null);
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const textRequired = type !== "udalost";

  function pickFile(f: File | null) {
    setErrors((e) => ({ ...e, file: "" }));
    if (!f) return setFile(null);
    const isPhoto = type === "predaj";
    const okType = isPhoto ? PHOTO_TYPES.split(",").includes(f.type) : !!ALLOWED_DOCUMENT_MIME[f.type];
    if (!okType) {
      setErrors((e) => ({ ...e, file: t("error.fileType") }));
      return setFile(null);
    }
    if (f.size > (isPhoto ? PHOTO_MAX : MAX_DOCUMENT_SIZE)) {
      setErrors((e) => ({ ...e, file: t("error.fileTooLarge") }));
      return setFile(null);
    }
    setFile(f);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = t("error.required");
    if (textRequired && !text.trim()) e.text = t("error.required");
    if (type === "udalost") {
      if (!eventDate || Number.isNaN(new Date(eventDate).getTime())) e.eventDate = t("error.required");
      if (!place.trim()) e.place = t("error.required");
    }
    if (type === "pomoc" && !helpKind) e.helpKind = t("error.helpKind");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /** Board notice attachment → document library (same as the old picker). */
  async function uploadAttachment(f: File): Promise<string> {
    if (!entities.currentId) throw new Error("no-entity");
    const fd = new FormData();
    fd.append("file", f);
    fd.append("entityId", entities.currentId);
    fd.append("type", "other");
    fd.append("audience", "resident");
    const res = await fetch("/api/documents", { method: "POST", body: fd });
    if (!res.ok) throw new Error("upload");
    const { document } = await res.json();
    return document.id as string;
  }

  async function uploadPhoto(f: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("category", "community-posts");
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) throw new Error("upload");
    const { url } = await res.json();
    return url as string;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      let res: Response;
      if (type === "oznam") {
        let documentIds: string[] = [];
        if (file) {
          try {
            documentIds = [await uploadAttachment(file)];
          } catch {
            setErrors((x) => ({ ...x, file: t("error.upload") }));
            return;
          }
        }
        res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            content: text.trim(),
            category: important ? "urgent" : "info",
            isPinned: important,
            entranceId: entranceId || null,
            documentIds,
          }),
        });
      } else {
        let photoUrl: string | null = null;
        if (type === "predaj" && file) {
          try {
            photoUrl = await uploadPhoto(file);
          } catch {
            setErrors((x) => ({ ...x, file: t("error.upload") }));
            return;
          }
        }
        const body =
          type === "udalost"
            ? {
                type: "event",
                title: title.trim(),
                // API requires content; an event without text repeats the title
                // (the card hides content equal to the title).
                content: text.trim() || title.trim(),
                eventDate: new Date(eventDate).toISOString(),
                eventLocation: place.trim(),
              }
            : type === "pomoc"
              ? { type: helpKind, title: title.trim(), content: text.trim() }
              : {
                  type: price.trim() ? "sale" : "free",
                  title: title.trim(),
                  content: withPrice(text.trim(), t("priceLine"), price),
                  photoUrl,
                };
        res = await fetch("/api/community/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        setFormError(t("error.save"));
        return;
      }
      router.push("/board");
    } catch {
      setFormError(t("error.save"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ui-text">
          <Icon name={TYPE_ICON[type]} />
          {t(`type.${type}.label`)}
        </h2>
        {onChangeType ? (
          <Button variant="ghost" onClick={onChangeType}>
            <Icon name="chevronLeft" size={20} />
            {t("changeType")}
          </Button>
        ) : null}
      </div>

      {type === "pomoc" ? (
        <Field label={t("field.helpKind")} required error={errors.helpKind}>
          <div className="grid grid-cols-2 gap-3" role="group">
            {(["help_offer", "help_request"] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                size="lg"
                className={helpKind === k ? "border-ui-primary bg-ui-surface-muted ring-2 ring-ui-primary" : undefined}
                aria-pressed={helpKind === k}
                onClick={() => setHelpKind(k)}
              >
                {helpKind === k ? <Icon name="check" size={20} /> : null}
                {t(k === "help_offer" ? "field.offer" : "field.request")}
              </Button>
            ))}
          </div>
        </Field>
      ) : null}

      <Field label={t(type === "udalost" ? "field.eventTitle" : "field.title")} required error={errors.title}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          autoComplete="off"
        />
      </Field>

      {type === "udalost" ? (
        <>
          <Field label={t("field.eventDate")} required error={errors.eventDate}>
            <Input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </Field>
          <Field label={t("field.place")} required error={errors.place}>
            <Input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={255} />
          </Field>
        </>
      ) : null}

      <Field
        label={t(textRequired ? "field.text" : "field.textOptional")}
        required={textRequired}
        error={errors.text}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </Field>

      {type === "predaj" ? (
        <Field label={t("field.price")} hint={t("field.priceHint")}>
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            maxLength={40}
            inputMode="text"
            className="sm:max-w-xs"
          />
        </Field>
      ) : null}

      {type === "oznam" || type === "predaj" ? (
        <FilePicker
          label={t(type === "oznam" ? "field.attachment" : "field.photo")}
          chooseLabel={t(type === "oznam" ? "file.choose" : "file.chooseImage")}
          accept={type === "oznam" ? Object.keys(ALLOWED_DOCUMENT_MIME).join(",") : PHOTO_TYPES}
          file={file}
          onChange={pickFile}
          error={errors.file}
        />
      ) : null}

      {type === "oznam" ? (
        <>
          <ImportantCheckbox checked={important} onChange={setImportant} />
          {entrances.length > 1 ? (
            <Field label={t("field.scope")}>
              <Select value={entranceId} onChange={(e) => setEntranceId(e.target.value)}>
                <option value="">{t("field.scopeAll")}</option>
                {entrances.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </>
      ) : null}

      {formError ? (
        <p role="alert" className="text-base font-medium text-ui-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ButtonLink href="/board" variant="secondary">
          {t("cancel")}
        </ButtonLink>
        <Button type="submit" loading={submitting}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

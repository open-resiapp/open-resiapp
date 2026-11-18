"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, ConfirmDialog, Field, Icon, Input, Modal, Textarea, cn, useConfirm } from "@/components/ui";
import { focusWithinRing } from "@/components/ui/cn";
import { useRouter } from "@/i18n/navigation";

import { checkPhoto, MAX_PHOTOS, TITLE_MAX, type FaultVisibility } from "../engine/transitions";
import { jsonInit, useFaultApi } from "./useFaultApi";

// Reporter actions while the report is still `new` (BYT-20261118-004):
// edit text / location note, narrow to private, add or remove photos,
// withdraw. The server re-checks every rule (FAULT_NOT_EDITABLE /
// FAULT_WITHDRAW_NOT_ALLOWED once the board has touched it).

export function ReporterActions({
  fault,
}: {
  fault: {
    id: string;
    title: string;
    description: string | null;
    locationNote: string | null;
    visibility: FaultVisibility;
    photos: { id: string }[];
  };
}) {
  const t = useTranslations("Faults");
  const router = useRouter();
  const api = useFaultApi();
  const confirm = useConfirm();

  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [title, setTitle] = useState(fault.title);
  const [description, setDescription] = useState(fault.description ?? "");
  const [locationNote, setLocationNote] = useState(fault.locationNote ?? "");
  const [makePrivate, setMakePrivate] = useState(false);

  const saveEdit = async () => {
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      locationNote: locationNote.trim() || null,
    };
    if (makePrivate) body.visibility = "private";
    const res = await api.call(`/api/modules/faults/${fault.id}`, jsonInit("PATCH", body));
    if (res) {
      setEditing(false);
      router.refresh();
    }
  };

  const withdraw = async () => {
    const res = await api.call(`/api/modules/faults/${fault.id}/withdraw`, { method: "POST" });
    setWithdrawing(false);
    if (res) router.refresh();
  };

  const addPhotos = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    if (fault.photos.length + files.length > MAX_PHOTOS) {
      api.setError(t("errors.FAULT_TOO_MANY_PHOTOS"));
      return;
    }
    if (files.some((f) => !checkPhoto({ type: f.type, size: f.size }).ok)) {
      api.setError(t("errors.FAULT_PHOTO_INVALID"));
      return;
    }
    const form = new FormData();
    for (const f of files) form.append("photos", f);
    const res = await api.call(`/api/modules/faults/${fault.id}/photos`, { method: "POST", body: form });
    if (res) router.refresh();
  };

  const removePhoto = async (photoId: string, n: number) => {
    const ok = await confirm({
      title: t("detail.removePhotoTitle", { n }),
      description: t("detail.removePhotoWarn"),
      confirmLabel: t("detail.removePhotoConfirm"),
      cancelLabel: t("board.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await api.call(`/api/modules/faults/${fault.id}/photos/${photoId}`, { method: "DELETE" });
    if (res) router.refresh();
  };

  return (
    <section className="space-y-4" aria-label={t("detail.yourActions")}>
      {fault.photos.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {fault.photos.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated proxy route, not optimisable */}
              <img
                src={`/api/modules/faults/photos/${p.id}`}
                alt={t("detail.photoAlt", { n: i + 1 })}
                className="h-16 w-16 shrink-0 rounded-lg border border-ui-border object-cover"
              />
              <Button variant="ghost" onClick={() => removePhoto(p.id, i + 1)} disabled={api.busy}>
                <Icon name="trash" size={20} />
                {t("detail.removePhotoN", { n: i + 1 })}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={20} />
          {t("detail.edit")}
        </Button>
        {fault.photos.length < MAX_PHOTOS ? (
          <>
            <label
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ui-border-strong bg-ui-surface px-4 text-base font-medium text-ui-text hover:bg-ui-surface-muted",
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
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </>
        ) : null}
        <Button variant="danger" onClick={() => setWithdrawing(true)}>
          {t("detail.withdraw")}
        </Button>
      </div>
      {api.error && !editing ? <p role="alert" className="text-base text-ui-danger">{api.error}</p> : null}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={t("detail.edit")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={api.busy}>
              {t("board.cancel")}
            </Button>
            <Button loading={api.busy} onClick={saveEdit}>
              {t("board.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("report.titleLabel")} required>
            <Input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("report.descriptionLabel")}>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t("report.locationNoteLabel")}>
            <Input value={locationNote} maxLength={255} onChange={(e) => setLocationNote(e.target.value)} />
          </Field>
          {fault.visibility !== "private" ? (
            <label className="flex min-h-11 items-center gap-3 text-base text-ui-text">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={makePrivate}
                onChange={(e) => setMakePrivate(e.target.checked)}
              />
              {t("report.privateOnly")}
            </label>
          ) : null}
          {api.error ? <p role="alert" className="text-base text-ui-danger">{api.error}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={withdrawing}
        tone="danger"
        title={t("detail.withdrawTitle")}
        description={t("detail.withdrawWarn")}
        confirmLabel={t("detail.withdraw")}
        cancelLabel={t("board.cancel")}
        loading={api.busy}
        onConfirm={withdraw}
        onCancel={() => setWithdrawing(false)}
      />
    </section>
  );
}

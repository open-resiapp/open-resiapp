"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, ConfirmDialog, Field, Input, Modal } from "@/components/ui";

export interface DirectoryValues {
  sharePhone: boolean;
  shareEmail: boolean;
  note: string;
  skills: string;
}

interface DirectoryEditModalProps {
  initial: DirectoryValues;
  hasEntry: boolean;
  onClose: () => void;
  /** Resolve true on success. */
  onSave: (values: DirectoryValues) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}

// Opt-in to the neighbours' directory. Mounted only while open, so the form
// starts from `initial` every time.
export default function DirectoryEditModal({
  initial,
  hasEntry,
  onClose,
  onSave,
  onDelete,
}: DirectoryEditModalProps) {
  const t = useTranslations("Community.directory");
  const tFeed = useTranslations("Feed.directory");
  const [values, setValues] = useState<DirectoryValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<boolean>) {
    setSubmitting(true);
    setError(null);
    const ok = await action().catch(() => false);
    setSubmitting(false);
    if (ok) {
      onClose();
    } else {
      setConfirmDelete(false);
      setError(tFeed("failed"));
    }
  }

  return (
    <>
      <Modal
        open={!confirmDelete}
        onClose={submitting ? () => {} : onClose}
        title={t("editTitle")}
        footer={
          <>
            {hasEntry ? (
              <Button
                variant="ghost"
                className="text-ui-danger sm:mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
              >
                {t("removeFully")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button onClick={() => run(() => onSave(values))} loading={submitting}>
              {t("save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-base text-ui-text-muted">{tFeed("intro")}</p>
          <CheckRow
            label={t("sharePhone")}
            checked={values.sharePhone}
            onChange={(v) => setValues({ ...values, sharePhone: v })}
          />
          <CheckRow
            label={t("shareEmail")}
            checked={values.shareEmail}
            onChange={(v) => setValues({ ...values, shareEmail: v })}
          />
          <Field label={t("skills")}>
            <Input
              value={values.skills}
              onChange={(e) => setValues({ ...values, skills: e.target.value })}
              maxLength={500}
              placeholder={t("skillsPlaceholder")}
            />
          </Field>
          <Field label={t("note")}>
            <Input
              value={values.note}
              onChange={(e) => setValues({ ...values, note: e.target.value })}
              maxLength={255}
              placeholder={t("notePlaceholder")}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-base font-medium text-ui-danger">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={t("removeFully")}
        description={tFeed("removeOwnConsequence")}
        confirmLabel={t("removeFully")}
        loading={submitting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => run(onDelete)}
      />
    </>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-ui-border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-6 shrink-0 accent-[var(--ui-primary)]"
      />
      <span className="text-base text-ui-text">{label}</span>
    </label>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface DirectoryValues {
  sharePhone: boolean;
  shareEmail: boolean;
  note: string;
  skills: string;
}

interface DirectoryEditModalProps {
  open: boolean;
  initial: DirectoryValues;
  onClose: () => void;
  onSave: (values: DirectoryValues) => Promise<void>;
  onDelete: () => Promise<void>;
  hasEntry: boolean;
}

export default function DirectoryEditModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  hasEntry,
}: DirectoryEditModalProps) {
  const t = useTranslations("Community.directory");
  const [values, setValues] = useState<DirectoryValues>(initial);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setValues(initial);
  }, [initial, open]);

  if (!open) return null;

  async function handleSave() {
    setSubmitting(true);
    try {
      await onSave(values);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t("confirmDelete"))) return;
    setSubmitting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t("editTitle")}</h3>

        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={values.sharePhone}
              onChange={(e) =>
                setValues({ ...values, sharePhone: e.target.checked })
              }
              className="rounded border-gray-300"
            />
            <span className="text-base text-gray-700">{t("sharePhone")}</span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={values.shareEmail}
              onChange={(e) =>
                setValues({ ...values, shareEmail: e.target.checked })
              }
              className="rounded border-gray-300"
            />
            <span className="text-base text-gray-700">{t("shareEmail")}</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("note")}
            </label>
            <input
              type="text"
              value={values.note}
              onChange={(e) => setValues({ ...values, note: e.target.value })}
              maxLength={255}
              placeholder={t("notePlaceholder")}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("skills")}
            </label>
            <input
              type="text"
              value={values.skills}
              onChange={(e) => setValues({ ...values, skills: e.target.value })}
              maxLength={500}
              placeholder={t("skillsPlaceholder")}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 flex-wrap">
          {hasEntry ? (
            <button
              onClick={handleDelete}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg"
            >
              {t("removeFully")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {submitting ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

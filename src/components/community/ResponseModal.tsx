"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface ResponseModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
  defaultContent?: string;
}

export default function ResponseModal({
  open,
  onClose,
  onSubmit,
  defaultContent = "",
}: ResponseModalProps) {
  const t = useTranslations("Community");
  const [content, setContent] = useState(defaultContent);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 dark:bg-gray-800">
        <h3 className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">{t("respondTitle")}</h3>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
          placeholder={t("respondPlaceholder")}
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !content.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {submitting ? t("sending") : t("send")}
          </button>
        </div>
      </div>
    </div>
  );
}

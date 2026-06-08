"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PostCategory } from "@/types";
import DocumentAttachmentPicker, {
  type AttachedDoc,
} from "@/components/documents/DocumentAttachmentPicker";

const categoryValues: PostCategory[] = ["info", "urgent", "event", "maintenance"];
const categoryKeys: Record<PostCategory, string> = {
  info: "categoryInfo",
  urgent: "categoryUrgent",
  event: "categoryEvent",
  maintenance: "categoryMaintenance",
};

interface Entrance {
  id: string;
  name: string;
}

interface NewPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  entrances?: Entrance[];
}

export default function NewPostModal({
  isOpen,
  onClose,
  onCreated,
  entrances,
}: NewPostModalProps) {
  const t = useTranslations("PostModal");
  const tPost = useTranslations("PostCard");
  const tBoard = useTranslations("Board");
  const tCommon = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<AttachedDoc[]>([]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        content: formData.get("content"),
        category: formData.get("category"),
        isPinned: formData.get("isPinned") === "on",
        entranceId: formData.get("entranceId") || null,
        documentIds: attachments.map((a) => a.id),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("createFailed"));
      setLoading(false);
      return;
    }

    setLoading(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 dark:bg-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("newTitle")}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none dark:text-gray-400 dark:hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("titleLabel")}
            </label>
            <input
              name="title"
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("categoryLabel")}
            </label>
            <select
              name="category"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              {categoryValues.map((c) => (
                <option key={c} value={c}>
                  {tPost(categoryKeys[c])}
                </option>
              ))}
            </select>
          </div>

          {entrances && entrances.length > 0 && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {tBoard("scopeEntrance")}
              </label>
              <select
                name="entranceId"
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">{tBoard("scopeAll")}</option>
                {entrances.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("contentLabel")}
            </label>
            <textarea
              name="content"
              required
              rows={5}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            />
          </div>

          <label className="flex items-center gap-2 text-base text-gray-700 dark:text-gray-200">
            <input
              name="isPinned"
              type="checkbox"
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
            />
            {t("pinLabel")}
          </label>

          <DocumentAttachmentPicker value={attachments} onChange={setAttachments} />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? tCommon("saving") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

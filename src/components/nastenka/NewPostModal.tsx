"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PostCategory } from "@/types";

const categoryValues: PostCategory[] = ["info", "urgent", "event", "maintenance"];
const categoryKeys: Record<PostCategory, string> = {
  info: "categoryInfo",
  urgent: "categoryUrgent",
  event: "categoryEvent",
  maintenance: "categoryMaintenance",
};

interface NewPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function NewPostModal({
  isOpen,
  onClose,
  onCreated,
}: NewPostModalProps) {
  const t = useTranslations("PostModal");
  const tPost = useTranslations("PostCard");
  const tCommon = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      <div className="bg-white rounded-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">{t("newTitle")}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("titleLabel")}
            </label>
            <input
              name="title"
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("categoryLabel")}
            </label>
            <select
              name="category"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {categoryValues.map((c) => (
                <option key={c} value={c}>
                  {tPost(categoryKeys[c])}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("contentLabel")}
            </label>
            <textarea
              name="content"
              required
              rows={5}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical"
            />
          </div>

          <label className="flex items-center gap-2 text-base text-gray-700">
            <input
              name="isPinned"
              type="checkbox"
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t("pinLabel")}
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
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

"use client";

import { useState } from "react";
import type { PostCategory } from "@/types";

const categories: { value: PostCategory; label: string }[] = [
  { value: "info", label: "Informácia" },
  { value: "urgent", label: "Dôležité" },
  { value: "event", label: "Udalosť" },
  { value: "maintenance", label: "Údržba" },
];

interface EditPostModalProps {
  isOpen: boolean;
  post: {
    id: string;
    title: string;
    content: string;
    category: PostCategory;
    isPinned: boolean;
  };
  onClose: () => void;
  onSaved: () => void;
}

export default function EditPostModal({
  isOpen,
  post,
  onClose,
  onSaved,
}: EditPostModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
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
      setError(data.error || "Nepodarilo sa uložiť zmeny");
      setLoading(false);
      return;
    }

    setLoading(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Upraviť príspevok</h2>
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
              Nadpis
            </label>
            <input
              name="title"
              required
              defaultValue={post.title}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Kategória
            </label>
            <select
              name="category"
              defaultValue={post.category}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Obsah
            </label>
            <textarea
              name="content"
              required
              rows={5}
              defaultValue={post.content}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical"
            />
          </div>

          <label className="flex items-center gap-2 text-base text-gray-700">
            <input
              name="isPinned"
              type="checkbox"
              defaultChecked={post.isPinned}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Pripnúť príspevok
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? "Ukladám..." : "Uložiť"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

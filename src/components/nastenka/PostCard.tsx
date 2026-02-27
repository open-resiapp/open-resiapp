"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { PostCategory } from "@/types";

const categoryKeys: Record<PostCategory, string> = {
  info: "categoryInfo",
  urgent: "categoryUrgent",
  event: "categoryEvent",
  maintenance: "categoryMaintenance",
};

const categoryStyles: Record<PostCategory, { bg: string; text: string }> = {
  info: { bg: "bg-blue-100", text: "text-blue-700" },
  urgent: { bg: "bg-red-100", text: "text-red-700" },
  event: { bg: "bg-green-100", text: "text-green-700" },
  maintenance: { bg: "bg-yellow-100", text: "text-yellow-700" },
};

interface PostCardProps {
  title: string;
  content: string;
  category: PostCategory;
  authorName: string;
  createdAt: string;
  isPinned: boolean;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
}

export default function PostCard({
  title,
  content,
  category,
  authorName,
  createdAt,
  isPinned,
  isAdmin,
  onEdit,
  onDelete,
  onTogglePin,
}: PostCardProps) {
  const t = useTranslations("PostCard");
  const format = useFormatter();
  const style = categoryStyles[category] || categoryStyles.info;

  return (
    <div
      className={`bg-white rounded-xl border p-6 ${
        isPinned ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isPinned && (
            <span className="text-sm font-medium text-blue-600">
              {t("pinned")}
            </span>
          )}
          <span
            className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${style.bg} ${style.text}`}
          >
            {t(categoryKeys[category])}
          </span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onTogglePin}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {isPinned ? t("unpin") : t("pin")}
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              {t("edit")}
            </button>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              {t("delete")}
            </button>
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-base text-gray-700 whitespace-pre-wrap mb-4">
        {content}
      </p>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{authorName}</span>
        <time>
          {format.dateTime(new Date(createdAt), {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </time>
      </div>
    </div>
  );
}

"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { PostCategory } from "@/types";
import PostAttachments from "@/components/documents/PostAttachments";

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
  postId?: string;
  title: string;
  content: string;
  category: PostCategory;
  authorName: string;
  createdAt: string;
  isPinned: boolean;
  entranceName?: string | null;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
}

export default function PostCard({
  postId,
  title,
  content,
  category,
  authorName,
  createdAt,
  isPinned,
  entranceName,
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
      className={`bg-white rounded-xl border p-6 dark:bg-gray-800 ${
        isPinned
          ? "border-blue-300 ring-1 ring-blue-100 dark:border-blue-700 dark:ring-blue-900/40"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isPinned && (
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
              {t("pinned")}
            </span>
          )}
          <span
            className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${style.bg} ${style.text}`}
          >
            {t(categoryKeys[category])}
          </span>
          {entranceName && (
            <span className="px-2.5 py-0.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {entranceName}
            </span>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onTogglePin}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {isPinned ? t("unpin") : t("pin")}
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors dark:text-blue-300 dark:bg-blue-900/40 dark:hover:bg-blue-900/60"
            >
              {t("edit")}
            </button>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors dark:text-red-300 dark:bg-red-900/40 dark:hover:bg-red-900/60"
            >
              {t("delete")}
            </button>
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">{title}</h3>
      <p className="text-base text-gray-700 whitespace-pre-wrap mb-4 dark:text-gray-200">
        {content}
      </p>

      {postId && <PostAttachments targetType="board_post" targetId={postId} />}

      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
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

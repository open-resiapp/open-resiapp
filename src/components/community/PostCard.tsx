"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { ReactNode } from "react";

export type CommunityPostType =
  | "sale"
  | "free"
  | "borrow"
  | "help_request"
  | "help_offer"
  | "event";

export type CommunityPostStatus = "active" | "resolved" | "expired";

const typeStyles: Record<CommunityPostType, { bg: string; text: string; icon: string }> = {
  sale: { bg: "bg-blue-100", text: "text-blue-700", icon: "🏷️" },
  free: { bg: "bg-green-100", text: "text-green-700", icon: "🎁" },
  borrow: { bg: "bg-yellow-100", text: "text-yellow-700", icon: "🤲" },
  help_request: { bg: "bg-purple-100", text: "text-purple-700", icon: "🆘" },
  help_offer: { bg: "bg-teal-100", text: "text-teal-700", icon: "🤝" },
  event: { bg: "bg-pink-100", text: "text-pink-700", icon: "📅" },
};

interface PostCardProps {
  id: string;
  type: CommunityPostType;
  status: CommunityPostStatus;
  title: string;
  content: string;
  photoUrl?: string | null;
  eventDate?: string | null;
  eventLocation?: string | null;
  authorName: string;
  createdAt: string;
  entranceName?: string | null;
  canManage?: boolean;
  onResolve?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
}

export default function PostCard({
  type,
  status,
  title,
  content,
  photoUrl,
  eventDate,
  eventLocation,
  authorName,
  createdAt,
  entranceName,
  canManage,
  onResolve,
  onDelete,
  children,
}: PostCardProps) {
  const t = useTranslations("Community");
  const format = useFormatter();
  const style = typeStyles[type];

  return (
    <div
      className={`bg-white rounded-xl border p-6 ${
        status === "resolved" || status === "expired"
          ? "border-gray-200 opacity-70"
          : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${style.bg} ${style.text}`}
          >
            {style.icon} {t(`type.${type}`)}
          </span>
          {entranceName && (
            <span className="px-2.5 py-0.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
              {entranceName}
            </span>
          )}
          {status !== "active" && (
            <span className="px-2.5 py-0.5 rounded-full text-sm font-medium bg-gray-200 text-gray-700">
              {t(`status.${status}`)}
            </span>
          )}
        </div>

        {canManage && status === "active" && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {onResolve && (
              <button
                onClick={onResolve}
                className="px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
              >
                {t("markResolved")}
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                {t("delete")}
              </button>
            )}
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-base text-gray-700 whitespace-pre-wrap mb-3">{content}</p>

      {photoUrl && (
        <div className="mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={title}
            className="rounded-lg max-h-80 w-auto object-cover"
          />
        </div>
      )}

      {type === "event" && eventDate && (
        <div className="mb-3 text-sm text-gray-700">
          <div className="font-medium">
            {format.dateTime(new Date(eventDate), {
              weekday: "short",
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {eventLocation && <div className="text-gray-500">{eventLocation}</div>}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{authorName}</span>
        <time>
          {format.relativeTime(new Date(createdAt), new Date())}
        </time>
      </div>

      {children && <div className="mt-4 pt-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

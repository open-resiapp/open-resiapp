"use client";

import { useTranslations, useFormatter } from "next-intl";

export interface CommunityResponse {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string };
}

interface ResponseListProps {
  responses: CommunityResponse[];
  isAdmin?: boolean;
  onDelete?: (responseId: string) => void;
}

export default function ResponseList({ responses, isAdmin, onDelete }: ResponseListProps) {
  const t = useTranslations("Community");
  const format = useFormatter();

  if (responses.length === 0) {
    return <p className="text-sm text-gray-500">{t("noResponses")}</p>;
  }

  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <div key={r.id} className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-sm font-medium text-gray-900">{r.author.name}</span>
            <div className="flex items-center gap-2">
              <time className="text-xs text-gray-500">
                {format.relativeTime(new Date(r.createdAt), new Date())}
              </time>
              {isAdmin && onDelete && (
                <button
                  onClick={() => onDelete(r.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  {t("delete")}
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.content}</p>
        </div>
      ))}
    </div>
  );
}

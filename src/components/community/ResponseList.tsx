"use client";

import { useFormatter, useTranslations } from "next-intl";

export interface CommunityResponse {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

export default function ResponseList({ responses }: { responses: CommunityResponse[] }) {
  const t = useTranslations("Feed.responses");
  const format = useFormatter();

  if (responses.length === 0) {
    return <p className="text-base text-ui-text-muted">{t("none")}</p>;
  }

  return (
    <ul className="space-y-3">
      {responses.map((r) => (
        <li key={r.id} className="rounded-lg bg-ui-surface-muted p-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-base font-medium text-ui-text">{r.author?.name ?? "—"}</span>
            <time dateTime={r.createdAt} className="text-base text-ui-text-muted">
              {format.dateTime(new Date(r.createdAt), { day: "numeric", month: "long" })}
            </time>
          </div>
          <p className="whitespace-pre-wrap text-base text-ui-text break-words">{r.content}</p>
        </li>
      ))}
    </ul>
  );
}

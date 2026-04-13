"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { VotingStatus, VotingType } from "@/types";

const statusKeys: Record<VotingStatus, string> = {
  draft: "statusDraft",
  active: "statusActive",
  closed: "statusClosed",
};

const statusStyles: Record<VotingStatus, { bg: string; text: string }> = {
  draft: { bg: "bg-gray-100", text: "text-gray-700" },
  active: { bg: "bg-green-100", text: "text-green-700" },
  closed: { bg: "bg-red-100", text: "text-red-700" },
};

interface VotingCardProps {
  id: string;
  title: string;
  status: VotingStatus;
  votingType?: VotingType;
  entranceName?: string | null;
  startsAt: string;
  endsAt: string;
  createdByName: string;
}

export default function VotingCard({
  id,
  title,
  status,
  votingType,
  entranceName,
  startsAt,
  endsAt,
  createdByName,
}: VotingCardProps) {
  const t = useTranslations("Voting");
  const format = useFormatter();
  const style = statusStyles[status] || statusStyles.draft;

  return (
    <Link
      href={`/voting/${id}`}
      className="block bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {entranceName && (
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
              {entranceName}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {votingType && (
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                votingType === "meeting"
                  ? "bg-purple-100 text-purple-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {votingType === "meeting" ? t("typeMeeting") : t("typeWritten")}
            </span>
          )}
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${style.bg} ${style.text}`}
          >
            {t(statusKeys[status])}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
        <span>
          {t("from")}{" "}
          {format.dateTime(new Date(startsAt), {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span>
          {t("to")}{" "}
          {format.dateTime(new Date(endsAt), {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span>{t("createdBy", { name: createdByName })}</span>
      </div>
    </Link>
  );
}

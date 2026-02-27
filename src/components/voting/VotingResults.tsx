"use client";

import { useTranslations } from "next-intl";
import type { VotingResults as VotingResultsType } from "@/types";

interface VotingResultsProps {
  results: VotingResultsType;
  totalVotes: number;
}

function ResultBar({
  label,
  percent,
  color,
}: {
  label: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-base font-medium text-gray-700">{label}</span>
        <span className="text-base font-bold text-gray-900">
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4">
        <div
          className={`${color} h-4 rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function VotingResults({
  results,
  totalVotes,
}: VotingResultsProps) {
  const t = useTranslations("VotingResults");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-4">{t("title")}</h3>

      <div className="space-y-4 mb-6">
        <ResultBar
          label={t("for")}
          percent={results.zaPercent}
          color="bg-green-500"
        />
        <ResultBar
          label={t("against")}
          percent={results.protiPercent}
          color="bg-red-500"
        />
        <ResultBar
          label={t("abstain")}
          percent={results.zdrzalSaPercent}
          color="bg-gray-400"
        />
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <span className="text-base text-gray-500">
          {t("totalVotes", { count: totalVotes })}
        </span>
        <span
          className={`px-4 py-2 rounded-lg text-base font-bold ${
            results.passed
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {results.passed ? t("approved") : t("notApproved")}
        </span>
      </div>
    </div>
  );
}

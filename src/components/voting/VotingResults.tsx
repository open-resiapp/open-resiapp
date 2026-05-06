"use client";

import { useTranslations } from "next-intl";
import type { VotingResults as VotingResultsType, QuorumType } from "@/types";

interface VotingResultsProps {
  results: VotingResultsType;
  totalVotes: number;
}

const quorumKeys: Record<QuorumType, string> = {
  simple_present: "quorumSimplePresent",
  simple_all: "quorumSimpleAll",
  two_thirds_all: "quorumTwoThirdsAll",
  all_unanimous: "quorumAllUnanimous",
};

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
        <span className="text-base font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <span className="text-base font-bold text-gray-900 dark:text-gray-100">
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700">
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
    <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-gray-800 dark:border-gray-700">
      <h3 className="text-lg font-bold text-gray-900 mb-4 dark:text-gray-100">{t("title")}</h3>

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

      {/* Quorum status */}
      {results.quorumType && (
        <div className="flex items-center justify-between py-3 border-t border-gray-200 mb-2 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t(quorumKeys[results.quorumType])}
          </span>
          <span
            className={`px-3 py-1 rounded-lg text-sm font-bold ${
              results.quorumReached
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
            }`}
          >
            {results.quorumReached
              ? t("quorumReached")
              : t("quorumNotReached")}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <span className="text-base text-gray-500 dark:text-gray-400">
          {t("totalVotes", { count: totalVotes })}
        </span>
        <span
          className={`px-4 py-2 rounded-lg text-base font-bold ${
            results.passed
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
          }`}
        >
          {results.passed ? t("approved") : t("notApproved")}
        </span>
      </div>
    </div>
  );
}

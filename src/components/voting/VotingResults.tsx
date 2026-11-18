"use client";

import { useFormatter, useTranslations } from "next-intl";
import { resultBasis } from "@modules/voting/src/workflow/result-basis";
import type {
  VotingResults as VotingResultsType,
  QuorumType,
  UnitResolution,
  VoteChoice,
} from "@/types";

interface VotingResultsProps {
  results: VotingResultsType;
  totalVotes: number;
  /** Optional flat-number lookup so the breakdown can show "Byt 12" not a uuid. */
  flatNumbers?: Record<string, string>;
  country?: "sk" | "cz";
}

const quorumKeys: Record<QuorumType, string> = {
  simple_present: "quorumSimplePresent",
  simple_all: "quorumSimpleAll",
  two_thirds_all: "quorumTwoThirdsAll",
  four_fifths_all: "quorumFourFifthsAll",
  all_unanimous: "quorumAllUnanimous",
};

const choiceLabels: Record<VoteChoice, string> = {
  za: "for",
  proti: "against",
  zdrzal_sa: "abstain",
};

const rationaleKeys: Record<UnitResolution["rationale"], string> = {
  single_owner: "rationaleSingleOwner",
  unanimous: "rationaleUnanimous",
  majority_share: "rationaleMajorityShare",
  tie_abstain: "rationaleTieAbstain",
  no_quorum_within_unit: "rationaleNoQuorumWithinUnit",
};

const legalCitation = {
  sk: "§14 ods. 4 zák. č. 182/1993 Z.z.",
  cz: "§1187 zák. č. 89/2012 Sb.",
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
  flatNumbers,
  country = "sk",
}: VotingResultsProps) {
  const t = useTranslations("VotingResults");
  const format = useFormatter();
  const basis = resultBasis(results);
  const w = (n: number) => format.number(n, { maximumFractionDigits: 4 });
  const p1 = (n: number) => format.number(n, { maximumFractionDigits: 1 });

  const multiOwnerBreakdowns =
    results.unitBreakdowns?.filter((u) => u.hasMultipleOwners) ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 dark:bg-gray-800 dark:shadow-black/40">
      <h3 className="text-lg font-bold text-gray-900 mb-4 dark:text-gray-100">{t("title")}</h3>

      {/* 2026-11-18: the verdict's own basis first — for *_all quorums the
          za weight is judged against ALL possible weight, not the cast one
          (engine/index.ts finalizeTally; result-basis.ts re-states it). */}
      <div className="mb-6 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <p className="text-base font-bold text-gray-900 dark:text-gray-100">
          {t(`basis.forOf.${basis.kind}`, { pct: p1(basis.zaOfBasisPct) })}
        </p>
        <div
          className="relative h-4 w-full rounded-full bg-gray-200 dark:bg-gray-700"
          role="img"
          aria-label={t(`basis.forOf.${basis.kind}`, { pct: p1(basis.zaOfBasisPct) })}
        >
          <div
            className={`h-4 rounded-full ${results.passed ? "bg-green-500" : "bg-amber-500"}`}
            style={{ width: `${Math.min(basis.zaOfBasisPct, 100)}%` }}
          />
          <div
            className="absolute -top-1 h-6 w-0.5 bg-gray-900 dark:bg-gray-100"
            style={{ left: `${Math.min(basis.thresholdPct, 100)}%` }}
            aria-hidden="true"
          />
        </div>
        <p className="text-base text-gray-700 dark:text-gray-200">
          {t(`basis.threshold.${basis.threshold}.${basis.kind}`, {
            pct: p1(basis.thresholdPct),
            weight: w(basis.thresholdWeight),
          })}
        </p>
        <table className="w-full text-left text-base text-gray-900 dark:text-gray-100">
          <caption className="sr-only">{t("basis.tableCaption")}</caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="py-1 pr-2 font-medium">{t("basis.colChoice")}</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">{t("basis.colWeight")}</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">{t("basis.colOfCounted")}</th>
              {basis.kind !== "cast" && (
                <th scope="col" className="py-1 text-right font-medium">{t(`basis.colOf.${basis.kind}`)}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["for", results.za, results.zaPercent, basis.zaOfBasisPct],
                ["against", results.proti, results.protiPercent, basis.protiOfBasisPct],
                ["abstain", results.zdrzalSa, results.zdrzalSaPercent, basis.zdrzalSaOfBasisPct],
              ] as const
            ).map(([key, weight, ofCounted, ofBasis]) => (
              <tr key={key} className="border-b border-gray-100 dark:border-gray-700/60">
                <th scope="row" className="py-1 pr-2 font-medium">{t(key)}</th>
                <td className="py-1 pr-2 text-right tabular-nums">{w(weight)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{p1(ofCounted)} %</td>
                {basis.kind !== "cast" && (
                  <td className="py-1 text-right tabular-nums">{p1(ofBasis)} %</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="space-y-1 text-base text-gray-700 dark:text-gray-200">
          <div className="flex justify-between gap-2">
            <dt>{t("basis.counted")}</dt>
            <dd className="tabular-nums">{w(basis.countedWeight)}</dd>
          </div>
          {basis.kind === "present" && (
            <div className="flex justify-between gap-2">
              <dt>{t("basis.present")}</dt>
              <dd className="tabular-nums">{w(basis.basisWeight)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt>{t("basis.totalPossible")}</dt>
            <dd className="tabular-nums">{w(basis.totalPossibleWeight)}</dd>
          </div>
        </dl>
      </div>

      <p className="mb-2 text-base font-medium text-gray-700 dark:text-gray-200">
        {t("basis.distributionHeading")}
      </p>
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
          <span className="text-base text-gray-500 dark:text-gray-400">
            {t(quorumKeys[results.quorumType])}
          </span>
          <span
            className={`px-3 py-1 rounded-lg text-base font-bold ${
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

      {multiOwnerBreakdowns.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("multiOwnerTitle")}
          </h4>
          <p className="text-base text-gray-600 dark:text-gray-400 mb-3">
            {t("multiOwnerHelp", { law: legalCitation[country] })}
          </p>
          <div className="space-y-3">
            {multiOwnerBreakdowns.map((u) => {
              const flat = flatNumbers?.[u.unitEntityId];
              return (
                <div
                  key={u.unitEntityId}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {flat ? t("flatLabel", { number: flat }) : u.unitEntityId.slice(0, 8)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-base font-semibold ${resolvedColor(u.resolved)}`}
                    >
                      {t(choiceLabels[u.resolved])}
                    </span>
                  </div>
                  <ul className="text-base text-gray-700 dark:text-gray-300 space-y-0.5 mb-2">
                    {u.breakdown.map((b, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {b.userName ?? t("anonymousOwner")}{" "}
                          <span className="text-gray-400">
                            ({b.ownerShareNumerator}/{b.ownerShareDenominator})
                          </span>
                        </span>
                        <span className="font-medium">
                          {t(choiceLabels[b.choice])}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-base text-gray-500 dark:text-gray-400 italic">
                    {t(rationaleKeys[u.rationale])}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function resolvedColor(c: VoteChoice): string {
  if (c === "za")
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200";
  if (c === "proti")
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200";
  return "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
}

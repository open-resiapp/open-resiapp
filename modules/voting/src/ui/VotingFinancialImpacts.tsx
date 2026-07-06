"use client";

// Financial impacts of a voting (voting→accounting wedge, AC 515). Shows the
// treasurer-reviewable drafts + posted entries that the voting's passed
// financial items spawned. Self-contained: fetches its own data and renders
// nothing until there is at least one impact, so it's safe to drop onto the
// voting detail page unconditionally.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatEur } from "@modules/accounting/src/lib/money";

interface Impact {
  votingItemId: string;
  title: string;
  feeScheduleDraft: { id: string; status: string } | null;
  expenseAuthorisation: {
    id: string;
    status: string;
    amountCents: number;
    usedExpenseId: string | null;
  } | null;
  journalEntryCount: number;
}

export default function VotingFinancialImpacts({
  votingId,
}: {
  votingId: string;
}) {
  const t = useTranslations("Accounting.votingImpacts");
  const [impacts, setImpacts] = useState<Impact[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/accounting/voting-impacts?votingId=${votingId}`)
      .then((r) => (r.ok ? r.json() : { impacts: [] }))
      .then((d) => alive && setImpacts(d.impacts ?? []))
      .catch(() => alive && setImpacts([]));
    return () => {
      alive = false;
    };
  }, [votingId]);

  if (!impacts || impacts.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mt-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t("title")}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t("subtitle")}
      </p>
      <ul className="space-y-3">
        {impacts.map((i) => (
          <li
            key={i.votingItemId}
            className="border-b border-gray-100 dark:border-gray-800 pb-3 last:border-0 last:pb-0"
          >
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {i.title}
            </p>
            <div className="flex flex-wrap gap-2 mt-1 text-xs">
              {i.feeScheduleDraft && (
                <Link
                  href={`/accounting/predpis/${i.feeScheduleDraft.id}`}
                  className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 hover:underline"
                >
                  {t("feeScheduleDraft")} · {t(`status_${i.feeScheduleDraft.status}`)}
                </Link>
              )}
              {i.expenseAuthorisation && (
                <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                  {t("expenseAuthorisation")} ·{" "}
                  {formatEur(i.expenseAuthorisation.amountCents)} ·{" "}
                  {t(`status_${i.expenseAuthorisation.status}`)}
                </span>
              )}
              {i.journalEntryCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                  {t("journalEntries", { count: i.journalEntryCount })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

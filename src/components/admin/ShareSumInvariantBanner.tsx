"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { useShell } from "@/components/layout/ShellContext";

/**
 * BYT-20260511-001 admin banner. Warns the admin when at least one
 * housing_unit's active memberships' owner_unit_share_* do not sum to 1/1.
 *
 * Renders nothing when there are no violations or the viewer is not an admin.
 * The violation list is resolved by the server layout (ShellData — empty
 * for non-admins), so the banner paints with the page, no client fetch.
 */
export default function ShareSumInvariantBanner() {
  const t = useTranslations("ShareSumInvariant");
  const { shareSumViolations: invalid } = useShell();

  if (invalid.length === 0) {
    return null;
  }

  const preview = invalid.slice(0, 5);

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4 mb-4 text-sm text-amber-900 dark:text-amber-100">
      <div className="font-semibold mb-1">
        {t("title", { count: invalid.length })}
      </div>
      <p className="mb-2">{t("body")}</p>
      <ul className="list-disc list-inside mb-2 space-y-0.5">
        {preview.map((u) => (
          <li key={u.unitEntityId}>
            {t("unitLine", {
              flatNumber: u.flatNumber,
              num: u.sumNumerator,
              den: u.sumDenominator,
            })}
          </li>
        ))}
        {invalid.length > preview.length && (
          <li className="italic">{t("moreCount", { count: invalid.length - preview.length })}</li>
        )}
      </ul>
      <Link
        href="/owners"
        className="inline-block px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium"
      >
        {t("action")}
      </Link>
    </div>
  );
}

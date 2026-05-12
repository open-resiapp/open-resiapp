"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

interface InvalidUnit {
  unitEntityId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

/**
 * BYT-20260511-001 admin banner. Warns the admin when at least one
 * housing_unit's active memberships' owner_unit_share_* do not sum to 1/1.
 *
 * Renders nothing when there are no violations or the viewer is not an admin.
 */
export default function ShareSumInvariantBanner() {
  const { data: session, status } = useSession();
  const t = useTranslations("ShareSumInvariant");
  const [invalid, setInvalid] = useState<InvalidUnit[] | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const isAdmin = hasPermission(role, "manageUsers");

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    fetch("/api/admin/share-sum-invariants")
      .then((r) => (r.ok ? r.json() : { invalid: [] }))
      .then((data: { invalid: InvalidUnit[] }) => setInvalid(data.invalid))
      .catch(() => setInvalid([]));
  }, [status, isAdmin]);

  if (!isAdmin || !invalid || invalid.length === 0) {
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

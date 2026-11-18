"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui";
import type { ImportError, LvParseReport, OwnerGroup } from "@/lib/import/types";

import type { ImportCommitSummary, WizardPreview } from "./actions";

// Presentational panels of the import wizard (page.tsx owns the state).
// All copy via next-intl (`Import.*`), 16px minimum text.

type T = ReturnType<typeof useTranslations<"Import">>;

/** Error / warning text from its stable code (`Import.errors.<code>`). */
export function useImportErrorText(): (e: Pick<ImportError, "code" | "message" | "params" | "column">) => string {
  const t = useTranslations("Import");
  return (e) => {
    const key = `errors.${e.code}` as Parameters<T>[0];
    if (!t.has(key)) return t("errors.invalid_value", { column: columnText(t, e.column ?? "") });
    const params: Record<string, string | number> = { ...(e.params ?? {}) };
    if (typeof params.column === "string") params.column = columnText(t, params.column);
    else params.column = columnText(t, e.column ?? "");
    for (const k of ["unit", "sum", "imported", "existing", "diff", "value", "name", "address", "expected", "actual", "row", "firstRow", "min", "max"]) {
      if (params[k] === undefined) params[k] = "";
    }
    return t(key, params);
  };
}

export function columnText(t: T, key: string): string {
  if (!key) return "";
  const k = `columns.${key}` as Parameters<T>[0];
  return t.has(k) ? t(k) : key;
}

/** Text of an error thrown by a server action (message = code). */
export function actionErrorText(t: T, err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  const key = `errors.${code}` as Parameters<T>[0];
  return code && t.has(key) ? t(key) : t("errors.unexpected");
}

// ── LV parse report ──────────────────────────────────────

export function LvReportPanel({ report }: { report: LvParseReport }) {
  const t = useTranslations("Import");
  const skipped = report.skipped.filter((s) => s.reason !== "no_unit_sections");
  const noUnits = report.skipped.some((s) => s.reason === "no_unit_sections");
  return (
    <div
      role="status"
      className={`mt-4 rounded border px-3 py-2 text-base ${
        noUnits || skipped.length > 0
          ? "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100"
          : "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-100"
      }`}
    >
      <p className="font-medium">
        {t("lvReport.summary", {
          owners: report.recognisedOwners,
          units: report.recognisedUnits,
          skipped: skipped.length,
        })}
      </p>
      {noUnits && <p className="mt-1">{t("lvReport.noUnitSections")}</p>}
      {skipped.length > 0 && (
        <ul className="mt-2 list-disc pl-5 space-y-1">
          {skipped.map((s, i) => (
            <li key={i}>
              {s.lvRow !== null ? `${t("lvReport.lvRow", { n: s.lvRow })}: ` : ""}
              {s.text ? <span className="font-mono">{s.text}</span> : null}
              {" — "}
              {t(`lvReport.reasons.${s.reason}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Warnings (must be acknowledged) ──────────────────────

export function WarningsPanel({
  warnings,
  acknowledged,
  onToggle,
}: {
  warnings: ImportError[];
  acknowledged: Set<string>;
  onToggle: (code: string, on: boolean) => void;
}) {
  const t = useTranslations("Import");
  const text = useImportErrorText();
  if (warnings.length === 0) return null;
  return (
    <div className="mt-4 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-base text-amber-900 dark:text-amber-100">
      <p className="font-medium">{t("warningsTitle")}</p>
      <ul className="mt-2 space-y-2">
        {warnings.map((w) => (
          <li key={w.code}>
            <p>{text(w)}</p>
            <label className="mt-1 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={acknowledged.has(w.code)}
                onChange={(e) => onToggle(w.code, e.target.checked)}
              />
              <span>{t("warningAcknowledge")}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Owner groups (one person, several units) ─────────────

export function OwnerGroupsPanel({
  groups,
  split,
  onChange,
  disabled,
}: {
  groups: OwnerGroup[];
  split: Set<string>;
  onChange: (key: string, separate: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Import");
  if (groups.length === 0) return null;
  return (
    <div className="mt-4 rounded border border-gray-200 dark:border-gray-800 px-3 py-2 text-base">
      <p className="font-medium text-gray-900 dark:text-gray-100">{t("ownerGroups.title")}</p>
      <p className="text-gray-600 dark:text-gray-400">{t("ownerGroups.body")}</p>
      <ul className="mt-2 space-y-2">
        {groups.map((g) => {
          const separate = split.has(g.key);
          return (
            <li
              key={g.key}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-gray-100 dark:border-gray-800 pt-2"
            >
              <div>
                <span className="font-medium text-gray-900 dark:text-gray-100">{g.name}</span>{" "}
                <span className="text-gray-600 dark:text-gray-400">
                  {t("ownerGroups.units", { units: g.units.join(", "), rows: g.rows.join(", ") })}
                </span>
              </div>
              <div className="flex gap-2" role="group" aria-label={g.name}>
                <Button
                  type="button"
                  variant={separate ? "secondary" : "primary"}
                  aria-pressed={!separate}
                  disabled={disabled}
                  onClick={() => onChange(g.key, false)}
                >
                  {t("ownerGroups.samePerson")}
                </Button>
                <Button
                  type="button"
                  variant={separate ? "primary" : "secondary"}
                  aria-pressed={separate}
                  // One e-mail = one login account; such a group cannot be split.
                  disabled={disabled || g.key.startsWith("e:")}
                  onClick={() => onChange(g.key, true)}
                >
                  {t("ownerGroups.differentPeople")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Update-contacts plan ─────────────────────────────────

export function ContactPlanPanel({ plan }: { plan: NonNullable<WizardPreview["contactPlan"]> }) {
  const t = useTranslations("Import");
  return (
    <div className="mt-4 text-base">
      <p className="font-medium text-gray-900 dark:text-gray-100">
        {t("contacts.planSummary", { changes: plan.changes.length, issues: plan.issues.length })}
      </p>
      {plan.changes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 space-y-1 text-gray-800 dark:text-gray-200">
          {plan.changes.map((c) => (
            <li key={c.userId}>
              {c.name} ({c.unit})
              {c.email ? ` — ${t("contacts.setEmail", { email: c.email })}` : ""}
              {c.phone ? ` — ${t("contacts.setPhone", { phone: c.phone })}` : ""}
            </li>
          ))}
        </ul>
      )}
      <ContactIssues issues={plan.issues} />
    </div>
  );
}

function ContactIssues({ issues }: { issues: NonNullable<WizardPreview["contactPlan"]>["issues"] }) {
  const t = useTranslations("Import");
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-900 dark:text-amber-200">
      {issues.map((i, idx) => (
        <li key={idx}>
          {t("contacts.issueLine", { row: i.row, unit: i.unit, name: i.name })}{" "}
          {t(`contacts.issues.${i.code}`)}
        </li>
      ))}
    </ul>
  );
}

// ── Commit summary + "Toto ste vy?" ──────────────────────

export function CommitSummaryPanel({
  summary,
  onClaim,
  onStartOver,
}: {
  summary: ImportCommitSummary;
  onClaim: (userId: string) => Promise<string | null>;
  onStartOver: () => void;
}) {
  const t = useTranslations("Import");
  const [handled, setHandled] = useState<Record<string, "claimed" | "dismissed">>({});
  const [claimError, setClaimError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines: string[] =
    summary.mode === "update_contacts"
      ? [t("done.contactsUpdated", { count: summary.contactsUpdated })]
      : [
          t("done.unitsCreated", { count: summary.unitsCreated }),
          t("done.unitsReused", { count: summary.unitsReused }),
          t("done.unitsSkipped", { count: summary.unitsSkipped }),
          t("done.ownersCreated", { count: summary.ownersCreated }),
          t("done.ownersLinked", { count: summary.ownersLinked }),
          t("done.membershipsCreated", { count: summary.membershipsCreated }),
          t("done.membershipsSkipped", { count: summary.membershipsSkipped }),
        ];

  return (
    <section
      role="status"
      className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 p-4 text-base text-emerald-950 dark:text-emerald-50"
    >
      <h2 className="text-lg font-semibold mb-2">{t("done.title")}</h2>
      <ul className="list-disc pl-5 space-y-1">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {summary.skippedUnits.length > 0 && (
        <p className="mt-2">{t("done.skippedList", { units: summary.skippedUnits.join(", ") })}</p>
      )}
      {summary.mode === "update_contacts" && <ContactIssues issues={summary.contactIssues} />}

      {summary.adminCandidates
        .filter((c) => !handled[c.userId])
        .map((c) => (
          <div
            key={c.userId}
            className="mt-4 rounded border border-blue-200 dark:border-blue-900 bg-white dark:bg-gray-900 p-3 text-gray-900 dark:text-gray-100"
          >
            <p className="font-medium">{t("claim.question", { name: c.name })}</p>
            <p className="text-gray-700 dark:text-gray-300">
              {t("claim.body", { units: c.units.join(", ") })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setClaimError(null);
                  const err = await onClaim(c.userId);
                  setBusy(false);
                  if (err) setClaimError(err);
                  else setHandled((h) => ({ ...h, [c.userId]: "claimed" }));
                }}
              >
                {t("claim.yes")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setHandled((h) => ({ ...h, [c.userId]: "dismissed" }))}
              >
                {t("claim.no")}
              </Button>
            </div>
          </div>
        ))}
      {Object.values(handled).includes("claimed") && <p className="mt-3">{t("claim.done")}</p>}
      {claimError && (
        <p className="mt-3 text-red-700 dark:text-red-300" role="alert">
          {claimError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/owners" className="underline font-medium">
          {t("done.goOwners")}
        </Link>
        <Link href="/onboarding" className="underline font-medium">
          {t("done.goOnboarding")}
        </Link>
        <button type="button" onClick={onStartOver} className="underline font-medium">
          {t("done.startOver")}
        </button>
      </div>
    </section>
  );
}

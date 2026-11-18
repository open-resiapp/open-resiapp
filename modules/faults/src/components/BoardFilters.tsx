"use client";

import { useTranslations } from "next-intl";

import { Button, Field, Select, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { useRouter } from "@/i18n/navigation";

import {
  EMPTY_FILTERS,
  FILTER_COOKIE,
  filtersToParams,
  isEmptyFilters,
  serializeFilterCookie,
  type FaultFilters,
} from "../engine/filters";
import { FAULT_PRIORITIES, FAULT_STATUSES, type FaultStatus } from "../engine/transitions";

// Board list filters (BYT-20261118-004). URL params are the source of
// truth; every change also writes cookie `faults_filters` so reopening
// /poruchy without params restores them on the FIRST server render (no
// flash). "Zrušiť filtre" clears both.

export interface FilterOption {
  value: string;
  label: string;
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(f: FaultFilters) {
  try {
    document.cookie = isEmptyFilters(f)
      ? `${FILTER_COOKIE}=; path=/; max-age=0; samesite=lax`
      : `${FILTER_COOKIE}=${serializeFilterCookie(f)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Cookie blocked: filters still work through the URL.
  }
}

export function BoardFilters({
  filters,
  categories,
  assignees,
}: {
  filters: FaultFilters;
  categories: FilterOption[];
  assignees: FilterOption[];
}) {
  const t = useTranslations("Faults");
  const router = useRouter();

  const apply = (next: FaultFilters) => {
    writeCookie(next);
    router.push({ pathname: "/poruchy", query: filtersToParams(next) });
  };

  const toggleStatus = (s: FaultStatus) => {
    const has = filters.status.includes(s);
    apply({ ...filters, status: has ? filters.status.filter((x) => x !== s) : [...filters.status, s] });
  };

  return (
    <section aria-label={t("filters.label")} className="mb-5 space-y-4">
      <fieldset>
        <legend className="mb-2 text-base font-medium text-ui-text">{t("filters.status")}</legend>
        <ul className="flex flex-wrap gap-2">
          {FAULT_STATUSES.map((s) => {
            const on = filters.status.includes(s);
            return (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium",
                    on
                      ? "border-transparent bg-ui-primary text-ui-primary-text"
                      : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted",
                    focusRing
                  )}
                >
                  {t(`status.${s}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("filters.priority")} htmlFor="faults-filter-priority">
          <Select
            id="faults-filter-priority"
            value={filters.priority ?? ""}
            onChange={(e) =>
              apply({ ...filters, priority: (e.target.value || null) as FaultFilters["priority"] })
            }
          >
            <option value="">{t("filters.any")}</option>
            {FAULT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("filters.category")} htmlFor="faults-filter-category">
          <Select
            id="faults-filter-category"
            value={filters.categoryId ?? ""}
            onChange={(e) => apply({ ...filters, categoryId: e.target.value || null })}
          >
            <option value="">{t("filters.any")}</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("filters.assignee")} htmlFor="faults-filter-assignee">
          <Select
            id="faults-filter-assignee"
            value={filters.assignee ?? ""}
            onChange={(e) => apply({ ...filters, assignee: e.target.value || null })}
          >
            <option value="">{t("filters.any")}</option>
            <option value="none">{t("filters.unassigned")}</option>
            {assignees.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-3 text-base text-ui-text">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={filters.stale}
            onChange={(e) => apply({ ...filters, stale: e.target.checked })}
          />
          {t("filters.stale")}
        </label>
        {!isEmptyFilters(filters) ? (
          <Button variant="ghost" onClick={() => apply(EMPTY_FILTERS)}>
            {t("filters.clear")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

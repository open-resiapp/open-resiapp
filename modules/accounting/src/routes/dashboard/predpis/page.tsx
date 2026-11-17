"use client";

// Ročné úlohy (BYT-20261117-002 Phase 5) + the Mesačné platby (predpis)
// list (BYT-20260512-002 Phase 1). The hub on top lists the yearly jobs in
// order; below it the fee schedules per year, draft creation and links to
// the editor. Publish flow lives on the schedule detail page. Variable
// symbols moved to Nastavenia a pre účtovníka.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, PageHeader } from "@/components/ui";
import AnnualTasksHub, { type AnnualTaskStatus } from "@modules/accounting/src/components/AnnualTasksHub";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

interface ScheduleRow {
  id: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: string;
  effectiveTo: string | null;
  serviceCount: number;
}

export default function PredpisListPage() {
  const t = useTranslations("Accounting.predpis");
  const ta = useTranslations("Accounting.annual");
  const format = useFormatter();
  const router = useRouter();
  const { canWrite } = useAccountingAccess();

  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/fee-schedules")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { schedules: ScheduleRow[] }) => setSchedules(data.schedules))
      .catch(() => setError("load"));
  }, []);

  async function createDraft() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/fee-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      router.push(`/accounting/predpis/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create");
      setCreating(false);
    }
  }

  // Status of this year's monthly payments — already loaded for the list.
  const currentYear = new Date().getFullYear();
  let predpisStatus: AnnualTaskStatus | undefined;
  if (schedules) {
    const thisYear = schedules.filter((s) => s.year === currentYear);
    if (thisYear.some((s) => s.status === "published")) {
      predpisStatus = { label: ta("statusPublished", { year: currentYear }), tone: "success" };
    } else if (thisYear.length > 0) {
      predpisStatus = { label: ta("statusDraft", { year: currentYear }), tone: "warning" };
    } else {
      predpisStatus = { label: ta("statusMissing", { year: currentYear }), tone: "warning" };
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title={ta("title")} description={ta("subtitle")} />

      <AnnualTasksHub predpisStatus={predpisStatus} />

      <section id="mesacne-platby" aria-labelledby="predpis-title" className="scroll-mt-6">
        <h2 id="predpis-title" className="text-xl font-semibold text-ui-text">
          {t("title")}
        </h2>
        <p className="mb-4 mt-1 text-base text-ui-text-muted">{t("subtitle")}</p>

        {canWrite && (
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <Field label={t("yearLabel")} className="w-32">
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                min={2000}
                max={2100}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={createDraft}
              loading={creating}
              disabled={!Number.isInteger(year)}
            >
              {creating ? t("creating") : t("newSchedule")}
            </Button>
          </div>
        )}

        {error && error !== "load" && (
          <p role="alert" className="mb-4 text-base font-medium text-ui-danger">
            {t("submitError")} ({error})
          </p>
        )}

        {error === "load" ? (
          <p className="text-base text-ui-danger">{t("loadError")}</p>
        ) : !schedules ? (
          <LoadingBlock />
        ) : schedules.length === 0 ? (
          <Card>
            <EmptyState icon="calendar" title={t("empty")} />
          </Card>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id}>
                <Card padding="none">
                  <Link
                    href={`/accounting/predpis/${s.id}`}
                    className="flex min-h-11 flex-col gap-2 rounded-xl px-4 py-3 hover:bg-ui-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-base">
                      <span className="font-semibold text-ui-text">{s.year}</span>
                      <span className="ml-3 text-ui-text-muted">
                        {t("effectiveFromShort")}{" "}
                        {format.dateTime(new Date(s.effectiveFrom), { dateStyle: "medium" })}
                      </span>
                      <span className="ml-3 text-ui-text-muted">
                        {t("serviceCount", { count: s.serviceCount })}
                      </span>
                    </span>
                    <Badge tone={s.status === "published" ? "success" : "warning"}>
                      {t(`status.${s.status}`)}
                    </Badge>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

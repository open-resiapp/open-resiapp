import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EmptyState, PageHeader } from "@/components/ui";

import { defaultVisibility } from "../../engine/transitions";
import { getFaultActor } from "../../lib/authz.server";
import { listReporterLocations, type LocationOption } from "../../lib/locations.server";
import { ReportFlow, type ReportLocation } from "../../components/ReportFlow";

// /poruchy/nova — owner report flow (≤ 3 screens). Location options are
// built server-side from the reporter's active memberships only.

export default async function NewFaultPage() {
  const actor = await getFaultActor();
  if (!actor || !actor.canReport) notFound();
  const t = await getTranslations("Faults");
  const options = await listReporterLocations(actor.userId, actor.root.id);

  const label = (l: LocationOption): string => {
    if (l.kind === "root") return t("location.wholeHouse");
    if (l.kind === "unit") {
      return l.unitNumber ? t("location.myUnitNumber", { number: l.unitNumber }) : t("location.myUnitNamed", { name: l.name });
    }
    return t("location.myGroup", { name: l.name });
  };
  const locations: ReportLocation[] = options.map((l) => ({
    id: l.id,
    kind: l.kind,
    label: label(l),
    defaultVisibility: defaultVisibility(l.kind),
  }));
  const units = locations.filter((l) => l.kind === "unit");
  const preselected = units.length === 1 ? units[0].id : null;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("report.title")} backHref="/poruchy" backLabel={t("report.backToList")} />
      {locations.length === 0 ? (
        <EmptyState icon="alert" title={t("report.noLocations")} description={t("report.noLocationsHint")} />
      ) : (
        <ReportFlow locations={locations} preselectedId={preselected} />
      )}
    </div>
  );
}

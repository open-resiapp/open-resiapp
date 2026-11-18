import { getTranslations } from "next-intl/server";

import { ButtonLink, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { getViewer, isViewerGated, soft } from "@/lib/home.server";
import { canReadUnitLedger } from "@modules/accounting/src/lib/karta-bytu";
import {
  getOwnerPaymentSummary,
  listOwnershipWindows,
  syncDuePostings,
} from "@modules/accounting/src/lib/owner-payments";
import { MyPaymentsView } from "@modules/accounting/src/components/owner/MyPaymentsView";
import { getOwnerReadingsView } from "@modules/accounting/src/lib/reading-rounds";

// Moje platby (BYT-20261117-002 Phase 4) — one screen for the owner's unit.
// Server component; authorisation mirrors the karta bytu API: own units
// (active owner membership) always, any unit only for whole-dom readers
// (admin / treasurer / chairman) via canReadUnitLedger. Unit tabs only
// when the user owns more than one unit.

// Same check as owners/[id]: a malformed ?unit= must not reach a uuid column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MyPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string | string[] }>;
}) {
  const [viewer, params, t] = await Promise.all([
    getViewer(),
    searchParams,
    getTranslations("MyPayments"),
  ]);
  if (!viewer || isViewerGated(viewer)) return null;

  const header = <PageHeader title={t("title")} />;
  const root = viewer.root;

  if (!root || !viewer.enabledModules.has("accounting")) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <EmptyState icon="wallet" title={t("moduleOffTitle")} description={t("moduleOffBody")} />
      </div>
    );
  }

  const requested = typeof params.unit === "string" ? params.unit : null;
  if (requested !== null && !UUID_RE.test(requested)) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <EmptyState
          icon="alert"
          title={t("invalidUnitTitle")}
          description={t("invalidUnitBody")}
          action={
            <ButtonLink variant="secondary" href="/moje-platby">
              {t("invalidUnitAction")}
            </ButtonLink>
          }
        />
      </div>
    );
  }
  // Current AND former ownerships, each limited to its validity window
  // (a buyer never sees the seller's history; a seller keeps their own).
  const owned = await listOwnershipWindows(viewer.userId, root.id);

  let unitId: string | null = null;
  if (requested && owned.some((u) => u.id === requested)) {
    unitId = requested;
  } else if (requested) {
    const allowed = await canReadUnitLedger(viewer.userId, viewer.role, root.id, requested);
    if (!allowed) {
      return (
        <div className="mx-auto max-w-2xl">
          {header}
          <EmptyState icon="alert" title={t("forbidden")} />
        </div>
      );
    }
    unitId = requested;
  } else {
    unitId = owned[0]?.id ?? null;
  }

  if (!unitId) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <EmptyState icon="building" title={t("noUnitTitle")} description={t("noUnitBody")} />
      </div>
    );
  }

  // Same lazy posting the karta API runs before showing a balance. On a
  // lock timeout (or any failure) show the balance without fresh postings
  // instead of a 500 — same as the owner home.
  await soft(syncDuePostings(root.id, root.country), undefined);
  const [summary, readings] = await Promise.all([
    getOwnerPaymentSummary({
      entityId: root.id,
      country: root.country,
      unitEntityId: unitId,
      beneficiaryName: root.name,
      windows: owned.find((u) => u.id === unitId)?.windows,
    }),
    // Odpočty a osoby (BYT-20261118-006): only for a unit the viewer OWNS —
    // a board member opening another unit's page must not submit as owner.
    owned.some((u) => u.id === unitId && u.current)
      ? soft(
          getOwnerReadingsView({ entityId: root.id, unitEntityId: unitId, userId: viewer.userId }),
          null
        )
      : Promise.resolve(null),
  ]);

  const showTabs = owned.length > 1 && owned.some((u) => u.id === unitId);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("title")}
        description={
          summary && !showTabs ? t("unitSubtitle", { unit: summary.label }) : undefined
        }
      />
      {showTabs ? (
        <Tabs
          className="mb-6"
          aria-label={t("unitTabs")}
          value={unitId}
          items={owned.map((u) => ({
            value: u.id,
            label: t("unitTab", { unit: u.flatNumber ?? u.name }),
            href: { pathname: "/moje-platby", query: { unit: u.id } },
          }))}
        />
      ) : null}
      {summary ? (
        <MyPaymentsView summary={summary} country={root.country} readings={readings} />
      ) : (
        <EmptyState icon="alert" title={t("forbidden")} />
      )}
    </div>
  );
}

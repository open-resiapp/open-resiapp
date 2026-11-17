"use client";

// Platby od vlastníkov (BYT-20261117-002 Phase 5). One page, three tabs:
//   Z banky       — bank import + assigning payments to flats (treasurer)
//   Všetky platby — every recorded payment, void with a reason
//   Byty          — link to the flats-with-balances list (/accounting/karta)
// Manual entry lives in the "Zaevidovať platbu" dialog (same API call as
// the old inline form). /accounting/reconciliation redirects to ?tab=bank.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, LoadingBlock, PageHeader, Tabs } from "@/components/ui";
import ManualPaymentModal, {
  type PaymentUnitOption,
} from "@modules/accounting/src/components/ManualPaymentModal";
import PaymentsList, { type PaymentRow } from "@modules/accounting/src/components/PaymentsList";
import ReconciliationPanel from "@modules/accounting/src/components/ReconciliationPanel";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

type Tab = "bank" | "all";

export default function PaymentsPage({ hasBankData = false }: { hasBankData?: boolean }) {
  const t = useTranslations("Accounting.paymentsHub");
  const tp = useTranslations("Accounting.payments");
  const { canWrite } = useAccountingAccess();
  const params = useSearchParams();

  // ?unit=<id> (from a karta bytu) opens the dialog with that flat chosen.
  const presetUnit = params.get("unit");
  const requested = params.get("tab");
  // The bank queue is treasurer-only (writer-guarded API).
  const tab: Tab =
    canWrite && (requested === "bank" || (requested !== "all" && hasBankData)) ? "bank" : "all";

  const [data, setData] = useState<{ payments: PaymentRow[]; units: PaymentUnitOption[] } | null>(
    null
  );
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(!!presetUnit && canWrite);

  // One fetch serves both the list and the dialog's flat picker; it runs
  // only when one of them is on screen.
  const needsPayments = tab === "all" || modalOpen;
  const load = useCallback(() => {
    fetch("/api/accounting/payments")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { payments: PaymentRow[]; units: PaymentUnitOption[] }) => setData(d))
      .catch(() => setLoadError(true));
  }, []);
  const loaded = data !== null;
  useEffect(() => {
    if (needsPayments && !loaded) load();
  }, [needsPayments, loaded, load]);

  const tabs = [
    ...(canWrite ? [{ value: "bank", label: t("tabBank"), href: "/accounting/payments?tab=bank" }] : []),
    { value: "all", label: t("tabAll"), href: "/accounting/payments?tab=all" },
    { value: "units", label: t("tabUnits"), href: "/accounting/karta" },
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canWrite ? <Button onClick={() => setModalOpen(true)}>{t("record")}</Button> : undefined
        }
      />

      <Tabs className="mb-6" items={tabs} value={tab} aria-label={t("tabsLabel")} />

      {tab === "bank" ? (
        // A bank match changes the payment list too — drop the cache.
        <ReconciliationPanel onChanged={() => setData(null)} />
      ) : loadError ? (
        <p className="text-base text-ui-danger">{tp("loadError")}</p>
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <PaymentsList rows={data.payments} canWrite={canWrite} onChanged={load} />
      )}

      {canWrite && (
        <ManualPaymentModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          units={data?.units ?? null}
          presetUnitId={presetUnit}
          onSaved={load}
        />
      )}
    </div>
  );
}

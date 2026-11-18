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
import { Button, Card, Field, Input, LoadingBlock, PageHeader, Tabs } from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import ExportButtons from "@modules/accounting/src/components/ExportButtons";
import ManualPaymentModal, {
  type PaymentUnitOption,
} from "@modules/accounting/src/components/ManualPaymentModal";
import PaymentsList, { type PaymentRow } from "@modules/accounting/src/components/PaymentsList";
import ReconciliationPanel from "@modules/accounting/src/components/ReconciliationPanel";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

type Tab = "bank" | "all";

interface ListPayload {
  payments: PaymentRow[];
  total: number;
  page: number;
  pageSize: number | null;
  totals: {
    amountCents: number;
    allocatedCents: number;
    unallocatedCents: number;
    voidedCount: number;
  };
}

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

  const [data, setData] = useState<ListPayload | null>(null);
  const [units, setUnits] = useState<PaymentUnitOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(!!presetUnit && canWrite);
  // Date range on the receipt day + page; applied explicitly (button), so
  // typing a date does not fire a request per keystroke.
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [page, setPage] = useState(0);

  // One fetch serves both the list and the dialog's flat picker; it runs
  // only when one of them is on screen. The flat list is fetched once.
  const needsPayments = tab === "all" || modalOpen;
  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page) });
    if (range.from) qs.set("from", range.from);
    if (range.to) qs.set("to", range.to);
    if (units) qs.set("units", "0");
    fetch(`/api/accounting/payments?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: ListPayload & { units?: PaymentUnitOption[] }) => {
        setData(d);
        if (d.units) setUnits(d.units);
      })
      .catch(() => setLoadError(true));
    // `units` deliberately not a dependency: it only decides whether the
    // picker list rides along, and must not trigger a refetch itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, range]);
  const loaded = data !== null;
  useEffect(() => {
    if (needsPayments && !loaded) load();
  }, [needsPayments, loaded, load]);

  const applyRange = () => {
    setPage(0);
    setRange({ from: fromDraft, to: toDraft });
    setData(null);
  };
  const goPage = (p: number) => {
    setPage(p);
    setData(null);
  };
  const pageCount =
    data && data.pageSize ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

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
        <>
          <Card padding="sm" className="mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <Field label={tp("filterFrom")} className="sm:w-48">
                <Input
                  type="date"
                  value={fromDraft}
                  onChange={(e) => setFromDraft(e.target.value)}
                />
              </Field>
              <Field label={tp("filterTo")} className="sm:w-48">
                <Input
                  type="date"
                  value={toDraft}
                  onChange={(e) => setToDraft(e.target.value)}
                />
              </Field>
              <Button variant="secondary" onClick={applyRange}>
                {tp("filterApply")}
              </Button>
              {(range.from || range.to) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFromDraft("");
                    setToDraft("");
                    setPage(0);
                    setRange({ from: "", to: "" });
                    setData(null);
                  }}
                >
                  {tp("filterClear")}
                </Button>
              )}
            </div>
          </Card>

          {/* Totals over the WHOLE filtered range (all pages), voided
              payments excluded — what an auditor ticks against the bank. */}
          <Card padding="sm" className="mb-4">
            <dl className="grid grid-cols-1 gap-2 text-base sm:grid-cols-3">
              <div>
                <dt className="text-ui-text-muted">{tp("totalReceived", { count: data.total - data.totals.voidedCount })}</dt>
                <dd className="text-lg font-semibold text-ui-text">{formatEur(data.totals.amountCents)}</dd>
              </div>
              <div>
                <dt className="text-ui-text-muted">{tp("totalAllocated")}</dt>
                <dd className="text-lg font-semibold text-ui-text">{formatEur(data.totals.allocatedCents)}</dd>
              </div>
              <div>
                <dt className="text-ui-text-muted">{tp("totalCredit")}</dt>
                <dd className="text-lg font-semibold text-ui-text">{formatEur(data.totals.unallocatedCents)}</dd>
              </div>
            </dl>
            {data.totals.voidedCount > 0 && (
              <p className="mt-2 text-base text-ui-text-muted">
                {tp("totalVoidedNote", { count: data.totals.voidedCount })}
              </p>
            )}
            <div className="mt-3">
              <ExportButtons
                report="payments"
                params={{ from: range.from, to: range.to }}
              />
            </div>
          </Card>

          <PaymentsList rows={data.payments} canWrite={canWrite} onChanged={load} />

          {pageCount > 1 && (
            <nav
              aria-label={tp("pagingLabel")}
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
            >
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => goPage(page - 1)}
              >
                ← {tp("pagePrev")}
              </Button>
              <span className="text-base text-ui-text-muted">
                {tp("pageOf", { page: page + 1, pages: pageCount })}
              </span>
              <Button
                variant="secondary"
                disabled={page + 1 >= pageCount}
                onClick={() => goPage(page + 1)}
              >
                {tp("pageNext")} →
              </Button>
            </nav>
          )}
        </>
      )}

      {canWrite && (
        <ManualPaymentModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          units={units}
          presetUnitId={presetUnit}
          onSaved={load}
        />
      )}
    </div>
  );
}

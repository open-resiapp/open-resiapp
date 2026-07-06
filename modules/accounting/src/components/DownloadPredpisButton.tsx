"use client";

// Downloads the unit's monthly predpis PDF with PAY by square QR
// (BYT-20260512-002 Phase 1). Data comes from the server (amounts from
// the active schedule's stored assessments + QR payload); the QR PNG and
// the PDF render client-side (same pattern as DownloadMinutesButton).

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { formatEur } from "@modules/accounting/src/lib/money";

interface PdfData {
  unitLabel: string;
  vs: string;
  year: number;
  month: number;
  rows: { categorySlug: string; amountCents: number }[];
  totalCents: number;
  iban: string;
  payBySquare: string | null;
  building: { name: string; address: string; ico: string | null };
}

export default function DownloadPredpisButton({ unitId }: { unitId: string }) {
  const t = useTranslations("Accounting.predpisPdf");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/karta/${unitId}/predpis-pdf`);
      const data: PdfData | { error: string } = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : String(res.status));
      }

      const [{ pdf }, { default: PredpisPDF }, QRCode] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@modules/accounting/src/components/PredpisPDF"),
        import("qrcode"),
      ]);

      const qrDataUrl = data.payBySquare
        ? await QRCode.toDataURL(data.payBySquare, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 440,
          })
        : null;

      const monthLabel = format.dateTime(
        new Date(Date.UTC(data.year, data.month - 1, 1)),
        { month: "long", year: "numeric" }
      );

      const blob = await pdf(
        <PredpisPDF
          building={data.building}
          labels={{
            title: t("title"),
            subtitle: t("subtitle", { month: monthLabel }),
            unit: t("unit"),
            vs: t("vs"),
            service: t("service"),
            monthlyAmount: t("monthlyAmount"),
            total: t("total"),
            qrTitle: t("qrTitle"),
            iban: t("iban"),
            footer: t("footer"),
          }}
          unitLabel={data.unitLabel}
          vs={data.vs}
          rows={data.rows.map((r) => ({
            name: tCat(r.categorySlug as Parameters<typeof tCat>[0]),
            amount: formatEur(r.amountCents),
          }))}
          total={formatEur(data.totalCents)}
          iban={data.iban}
          qrDataUrl={qrDataUrl}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `predpis-${data.year}-${String(data.month).padStart(2, "0")}-${data.vs}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "pdf";
      // "No published predpis / no assessments" is not a failure — the
      // treasurer simply hasn't published a fee schedule for this month.
      setError(
        msg.includes("no published predpis") || msg.includes("no assessments")
          ? t("noPredpis")
          : `${t("error")} (${msg})`
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={generating}
        className="px-4 py-2 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded-lg disabled:opacity-50 text-sm"
      >
        {generating ? t("generating") : t("download")}
      </button>
      {error && (
        <p className="text-amber-700 dark:text-amber-400 text-xs mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

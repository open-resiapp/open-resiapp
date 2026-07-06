"use client";

// Downloads the unit's published vyúčtovanie PDF (SK template) with a
// dynamic PAY by square QR on the nedoplatok (BYT-20260512-002 Phase 4).
// Reads the FROZEN settlement rows — never recomputes.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatEur } from "@modules/accounting/src/lib/money";

interface PdfData {
  year: number;
  unitLabel: string;
  vs: string | null;
  lines: {
    categorySlug: string;
    prescribedCents: number;
    advancesCents: number;
    costShareCents: number;
    differenceCents: number;
    allocationKey: string | null;
  }[];
  totalCostCents: number;
  totalAdvancesCents: number;
  totalDifferenceCents: number;
  iban: string | null;
  payBySquare: string | null;
  building: { name: string; address: string; ico: string | null };
}

export default function DownloadVyuctovanieButton({
  unitId,
  year,
}: {
  unitId: string;
  year: number;
}) {
  const t = useTranslations("Accounting.vyuctovaniePdf");
  const tCat = useTranslations("Accounting.serviceCategories");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounting/karta/${unitId}/vyuctovanie-pdf?year=${year}`
      );
      const data: PdfData | { error: string } = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : String(res.status));
      }

      const [{ pdf }, { default: VyuctovaniePDFSk }, QRCode] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@modules/accounting/src/components/VyuctovaniePDFSk"),
          import("qrcode"),
        ]);

      const qrDataUrl = data.payBySquare
        ? await QRCode.toDataURL(data.payBySquare, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 400,
          })
        : null;

      const blob = await pdf(
        <VyuctovaniePDFSk
          building={data.building}
          labels={{
            unit: t("unit"),
            vs: t("vs"),
            service: t("service"),
            prescribed: t("prescribed"),
            advances: t("advances"),
            cost: t("cost"),
            difference: t("difference"),
            total: t("total"),
            nedoplatok: t("nedoplatok"),
            preplatok: t("preplatok"),
            settled: t("settled"),
            qrTitle: t("qrTitle"),
            iban: t("iban"),
            footer: t("footer"),
          }}
          year={data.year}
          unitLabel={data.unitLabel}
          vs={data.vs}
          rows={data.lines.map((l) => ({
            name: l.allocationKey
              ? `${tCat(l.categorySlug as Parameters<typeof tCat>[0])} (${t("keyLabel")}: ${t(`allocationKey_${l.allocationKey}` as Parameters<typeof t>[0])})`
              : tCat(l.categorySlug as Parameters<typeof tCat>[0]),
            prescribed: formatEur(l.prescribedCents),
            advances: formatEur(l.advancesCents),
            cost: formatEur(l.costShareCents),
            difference: formatEur(l.differenceCents),
          }))}
          totals={{
            advances: formatEur(data.totalAdvancesCents),
            cost: formatEur(data.totalCostCents),
            difference: formatEur(data.totalDifferenceCents),
          }}
          totalDifferenceCents={data.totalDifferenceCents}
          iban={data.iban}
          qrDataUrl={qrDataUrl}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vyuctovanie-${data.year}-${data.vs ?? data.unitLabel}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "pdf");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <span>
      <button
        onClick={handleDownload}
        disabled={generating}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
      >
        {generating ? t("generating") : t("download", { year })}
      </button>
      {error && (
        <span className="text-red-600 dark:text-red-400 text-xs ml-2">
          {t("error")}
        </span>
      )}
    </span>
  );
}

"use client";

// Generates the unit's upomienka PDF with a dynamic PAY by square QR for
// the full owed amount incl. lawful interest (BYT-20260512-002 Phase 5).
// Treasurer/admin only — the API enforces it.

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { formatEur } from "@modules/accounting/src/lib/money";

interface PdfData {
  asOf: string;
  unitLabel: string;
  vs: string | null;
  items: {
    categorySlug: string;
    periodYear: number;
    month: number;
    openCents: number;
    dueDate: string;
    daysLate: number;
    ratePct: number;
    interestCents: number;
  }[];
  totalOpenCents: number;
  totalInterestCents: number;
  iban: string | null;
  payBySquare: string | null;
  building: { name: string; address: string; ico: string | null };
}

export default function DownloadUpomienkaButton({
  unitId,
}: {
  unitId: string;
}) {
  const t = useTranslations("Accounting.upomienkaPdf");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounting/karta/${unitId}/upomienka-pdf`
      );
      const data: PdfData | { error: string } = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : String(res.status));
      }

      const [{ pdf }, { default: UpomienkaPDFSk }, QRCode] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@modules/accounting/src/components/UpomienkaPDFSk"),
          import("qrcode"),
        ]);

      const qrDataUrl = data.payBySquare
        ? await QRCode.toDataURL(data.payBySquare, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 400,
          })
        : null;

      const totalDemand = data.totalOpenCents + data.totalInterestCents;
      const blob = await pdf(
        <UpomienkaPDFSk
          building={data.building}
          labels={{
            unit: t("unit"),
            vs: t("vs"),
            intro: t("intro"),
            item: t("item"),
            due: t("due"),
            days: t("days"),
            open: t("open"),
            rate: t("rate"),
            interest: t("interest"),
            total: t("total"),
            demand: t("demand"),
            qrTitle: t("qrTitle"),
            iban: t("iban"),
            footer: t("footer"),
          }}
          asOf={format.dateTime(new Date(`${data.asOf}T00:00:00Z`), {
            dateStyle: "long",
          })}
          unitLabel={data.unitLabel}
          vs={data.vs}
          rows={data.items.map((i) => ({
            name: `${tCat(i.categorySlug as Parameters<typeof tCat>[0])} ${i.periodYear}-${String(i.month).padStart(2, "0")}`,
            due: format.dateTime(new Date(`${i.dueDate}T00:00:00Z`), {
              dateStyle: "medium",
            }),
            days: i.daysLate,
            open: formatEur(i.openCents),
            ratePct: i.ratePct,
            interest: formatEur(i.interestCents),
          }))}
          totals={{
            open: formatEur(data.totalOpenCents),
            interest: formatEur(data.totalInterestCents),
            demand: formatEur(totalDemand),
          }}
          iban={data.iban}
          qrDataUrl={qrDataUrl}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `upomienka-${data.asOf}-${data.vs ?? data.unitLabel}.pdf`;
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
        className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
      >
        {generating ? t("generating") : t("download")}
      </button>
      {error && (
        <span className="text-red-600 dark:text-red-400 text-xs ml-2">
          {t("error")}
        </span>
      )}
    </span>
  );
}

"use client";

// Generates upomienka PDFs with a dynamic PAY by square QR for the full
// owed amount incl. lawful interest (BYT-20260512-002 Phase 5).
//   - default export: one unit's letter (karta bytu)
//   - DownloadUpomienkyBulkButton: ONE PDF, a page per debtor (debtors page)
// Treasurer/admin only — the API enforces it. Overdue items arrive already
// netted against the unit's parked preplatok (overdue.ts).

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonClasses } from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import type {
  UpomienkaLabelsSk,
  UpomienkaLetterSk,
} from "@modules/accounting/src/components/UpomienkaPDFSk";

interface LetterData {
  asOf: string;
  unitLabel: string;
  ownerNames: string[];
  paymentDueDate: string;
  signatory: { name: string; role: "chairman" } | null;
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
}

type Building = { name: string; address: string; ico: string | null; dic?: string | null };

function useLetterBuilder() {
  const t = useTranslations("Accounting.upomienkaPdf");
  const tCat = useTranslations("Accounting.serviceCategories");
  const format = useFormatter();
  const day = (iso: string, style: "medium" | "long") =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: style, timeZone: "UTC" });

  const labels: UpomienkaLabelsSk = {
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
    addressee: t("addressee"),
    flat: t("flat"),
    signatureRole: t("signatureRole"),
  };

  async function toLetter(
    data: LetterData,
    building: Building,
    QRCode: typeof import("qrcode")
  ): Promise<UpomienkaLetterSk> {
    const qrDataUrl = data.payBySquare
      ? await QRCode.toDataURL(data.payBySquare, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 400,
        })
      : null;
    return {
      asOf: day(data.asOf, "long"),
      unitLabel: data.unitLabel,
      vs: data.vs,
      // The flat's address is the building's — owners have no separate
      // postal address in the app (a correspondence address is a follow-up).
      addressee: { names: data.ownerNames, address: building.address },
      paymentDue: day(data.paymentDueDate, "long"),
      signatoryName: data.signatory?.name ?? null,
      rows: data.items.map((i) => ({
        name: `${tCat(i.categorySlug as Parameters<typeof tCat>[0])} ${i.periodYear}-${String(i.month).padStart(2, "0")}`,
        due: day(i.dueDate, "medium"),
        days: i.daysLate,
        open: formatEur(i.openCents),
        ratePct: i.ratePct,
        interest: formatEur(i.interestCents),
      })),
      totals: {
        open: formatEur(data.totalOpenCents),
        interest: formatEur(data.totalInterestCents),
        demand: formatEur(data.totalOpenCents + data.totalInterestCents),
      },
      iban: data.iban,
      qrDataUrl,
    };
  }

  return { t, labels, toLetter };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DownloadUpomienkaButton({ unitId }: { unitId: string }) {
  const { t, labels, toLetter } = useLetterBuilder();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/karta/${unitId}/upomienka-pdf`);
      const data: (LetterData & { building: Building }) | { error: string } = await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : String(res.status));
      }
      const [{ pdf }, { default: UpomienkaPDFSk }, QRCode] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@modules/accounting/src/components/UpomienkaPDFSk"),
        import("qrcode"),
      ]);
      const letter = await toLetter(data, data.building, QRCode);
      const blob = await pdf(
        <UpomienkaPDFSk building={data.building} labels={labels} {...letter} />
      ).toBlob();
      saveBlob(blob, `upomienka-${data.asOf}-${data.vs ?? data.unitLabel}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "pdf");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={handleDownload}
        disabled={generating}
        className={buttonClasses({ variant: "danger" })}
      >
        {generating ? t("generating") : t("download")}
      </button>
      {error && (
        <span role="alert" className="text-base text-red-600 dark:text-red-400">
          {t("error")}
        </span>
      )}
    </span>
  );
}

/** One PDF, a page per debtor (net debt with overdue items). */
export function DownloadUpomienkyBulkButton() {
  const { t, labels, toLetter } = useLetterBuilder();
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<"error" | "none" | null>(null);

  async function handleDownload() {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/accounting/debtors/upomienky-pdf");
      const data: { letters: LetterData[]; building: Building } | { error: string } =
        await res.json();
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : String(res.status));
      }
      if (data.letters.length === 0) {
        setMessage("none");
        return;
      }
      const [{ pdf }, { UpomienkyBulkPDFSk }, QRCode] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@modules/accounting/src/components/UpomienkaPDFSk"),
        import("qrcode"),
      ]);
      const letters: UpomienkaLetterSk[] = [];
      for (const l of data.letters) letters.push(await toLetter(l, data.building, QRCode));
      const blob = await pdf(
        <UpomienkyBulkPDFSk building={data.building} labels={labels} letters={letters} />
      ).toBlob();
      saveBlob(blob, `upomienky-${data.letters[0].asOf}.pdf`);
    } catch {
      setMessage("error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={handleDownload}
        disabled={generating}
        className={buttonClasses({ variant: "secondary" })}
      >
        {generating ? t("generating") : t("downloadAll")}
      </button>
      {message === "error" && (
        <span role="alert" className="text-base text-red-600 dark:text-red-400">
          {t("error")}
        </span>
      )}
      {message === "none" && (
        <span role="status" className="text-base text-ui-text-muted">
          {t("noneToSend")}
        </span>
      )}
    </span>
  );
}

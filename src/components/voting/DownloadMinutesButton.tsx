"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { VotingResults, QuorumType } from "@/types";

interface VoteRow {
  id: string;
  ownerName: string | null;
  flatNumber: string;
  choice: string;
  voteType: string;
  createdAt: string;
  auditHash: string;
}

interface VotingInfo {
  title: string;
  votingType: string;
  initiatedBy: string;
  quorumType: QuorumType;
  startsAt: string;
  endsAt: string;
  createdBy: { name: string } | null;
}

interface BuildingInfo {
  name: string;
  address: string;
  ico: string | null;
}

interface DownloadMinutesButtonProps {
  votingId: string;
  voting: VotingInfo;
  voteData: {
    votes: VoteRow[];
    results: VotingResults;
  };
  building: BuildingInfo;
  legalNotice: string | null;
  entranceName?: string | null;
}

export default function DownloadMinutesButton({
  votingId,
  voting,
  voteData,
  building,
  legalNotice,
  entranceName,
}: DownloadMinutesButtonProps) {
  const t = useTranslations("VotingMinutes");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function handleDownload() {
    setGenerating(true);
    setError("");

    try {
      // Dynamic imports to avoid SSR issues
      const [{ pdf }, { default: VotingMinutesPDF }, QRCode] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/voting/VotingMinutesPDF"),
        import("qrcode"),
      ]);

      // Fetch mandates
      const mandatesRes = await fetch(`/api/mandates?votingId=${votingId}`);
      const mandateRows = mandatesRes.ok ? await mandatesRes.json() : [];

      // Generate QR code
      const qrData = `${window.location.origin}${window.location.pathname}`;
      const qrDataUrl = await QRCode.toDataURL(qrData, {
        width: 120,
        margin: 1,
      });

      const generatedAt = new Date().toLocaleString("sk-SK", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const doc = (
        <VotingMinutesPDF
          building={building}
          voting={voting}
          results={voteData.results}
          votes={voteData.votes}
          mandates={mandateRows}
          legalNotice={legalNotice}
          qrDataUrl={qrDataUrl}
          generatedAt={generatedAt}
          entranceName={entranceName}
        />
      );

      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zapisnica-${voting.title.slice(0, 40).replace(/[^a-zA-Z0-9áäčďéíľĺňóôŕšťúýžÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ ]/g, "").replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setError(t("downloadFailed"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={generating}
        className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors inline-flex items-center gap-2"
      >
        {generating ? (
          <>
            <svg
              className="animate-spin h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t("generating")}
          </>
        ) : (
          t("downloadButton")
        )}
      </button>
      {error && (
        <p className="text-red-600 text-sm mt-2">{error}</p>
      )}
    </div>
  );
}

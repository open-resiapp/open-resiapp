"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { VotingResults, QuorumType } from "@/types";
import { useCommunityKinds } from "@/hooks/useCommunityKinds";
import { timeZoneForCountry } from "@/lib/time-zone";
import {
  buildMinutesInput,
  type MinutesBallotIn,
} from "@modules/voting/src/workflow/minutes";

// BYT-20260609-008 multi-item ballot shapes (from /api/ballots).
interface BallotChoice {
  itemId: string;
  choice: string;
  itemAuditHash: string;
}
interface BallotRow {
  id: string;
  entityId: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  ballotHash: string;
  recordedAt: string;
  /** BYT-20261117-002 Phase 6 ("passkey" | "email" | null = before the gate). */
  confirmationMethod?: string | null;
  confirmedAt?: string | null;
  choices: BallotChoice[];
}
interface VotingItemRow {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
}

interface VotingInfo {
  title: string;
  votingType: string;
  initiatedBy: string;
  startsAt: string;
  endsAt: string;
  createdBy: { name: string } | null;
}

interface BuildingInfo {
  name: string;
  address: string;
  ico: string | null;
  country?: "sk" | "cz";
}

interface DownloadMinutesButtonProps {
  votingId: string;
  voting: VotingInfo;
  ballotData: {
    items: VotingItemRow[];
    results: (VotingResults & { itemId: string })[];
    ballots: BallotRow[];
  };
  building: BuildingInfo;
  legalNotice: string | null;
  entranceName?: string | null;
  /** BYT-20261118-002 §7 protocol source (place, officials, events, publication). */
  protocol?: Parameters<typeof buildMinutesInput>[0]["protocolSource"];
}

export default function DownloadMinutesButton({
  votingId,
  voting,
  ballotData,
  building,
  legalNotice,
  entranceName,
  protocol,
}: DownloadMinutesButtonProps) {
  const t = useTranslations("VotingMinutes");
  const tRoot = useTranslations();
  const { leafKind } = useCommunityKinds();
  // Phase 7b: pass the leaf kind label so the PDF renders the right
  // term ("Záhrada" instead of "Byt" for a garden community, etc.).
  // Falls back to "Byt" for pre-Phase-5 installs.
  const unitLabel = leafKind ? tRoot(`Kinds.${leafKind}`) : "Byt";
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

      // Confirmation method + time of each electronic ballot, in the
      // community's time zone (paper ballots carry none).
      const timeZone = timeZoneForCountry(building.country);
      const confirmationText = (b: MinutesBallotIn): string | null => {
        if (b.voteType === "paper") return null;
        if (b.confirmationMethod !== "passkey" && b.confirmationMethod !== "email") {
          return t("confirmation.legacy");
        }
        const at = b.confirmedAt ?? b.recordedAt;
        const date = new Date(at).toLocaleString("sk-SK", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone,
        });
        return t(`confirmation.${b.confirmationMethod}`, { date });
      };

      // BYT-20261118-002 §7: one typed hand-off object (assembly moved
      // unchanged into workflow/minutes.ts). `protocol` is passed but not
      // rendered until the Phase B legal sign-off.
      const { items, ballots, flatNumbersByUnitId, protocol: builtProtocol } = buildMinutesInput({
        items: ballotData.items,
        results: ballotData.results,
        ballots: ballotData.ballots,
        confirmationText,
        protocolSource: protocol,
      });

      const doc = (
        <VotingMinutesPDF
          building={building}
          voting={voting}
          items={items}
          ballots={ballots}
          mandates={mandateRows}
          legalNotice={legalNotice}
          qrDataUrl={qrDataUrl}
          generatedAt={generatedAt}
          entranceName={entranceName}
          country={building.country}
          flatNumbersByUnitId={flatNumbersByUnitId}
          unitLabel={unitLabel}
          protocol={builtProtocol}
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

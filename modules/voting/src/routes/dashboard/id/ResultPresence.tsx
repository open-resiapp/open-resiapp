"use client";

// 2026-11-18 — who counted as "present" in a meeting voting's result
// (SK §14b ods. 4 denominator, CZ §1206 ods. 2 quorum) plus the engine's
// result codes. Renders nothing for written votes (no `presence`).
import { useTranslations } from "next-intl";
import type { VotingResults } from "@/types";

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export default function ResultPresence({ results }: { results: VotingResults }) {
  const t = useTranslations("VotingResults");
  const p = results.presence;
  if (!p) return null;
  const codes = results.codes ?? [];

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-ui-border p-3 text-base">
      <p className="font-semibold text-ui-text">{t("presence.heading")}</p>
      <p className="text-ui-text">
        {t(p.basis === "attendance" ? "presence.attendance" : "presence.cast", {
          owners: p.owners,
          pct: Math.round(p.share * 1000) / 10,
        })}
      </p>
      {results.quorumType === "simple_present" && (
        <p className="text-ui-text-muted">
          {t("presence.forOfPresent", { pct: pct(results.za, p.weight) })}
        </p>
      )}
      {p.meetingQuorumReached !== undefined && (
        <p className={p.meetingQuorumReached ? "text-ui-text" : "font-semibold text-ui-danger"}>
          {t(p.meetingQuorumReached ? "presence.quorumMet" : "presence.quorumNotMet")}
        </p>
      )}
      {codes.map((c) => (
        <p
          key={c}
          role="status"
          className={c === "MEETING_QUORUM_NOT_REACHED" ? "font-semibold text-ui-danger" : "font-semibold text-ui-warning"}
        >
          {t(`codes.${c}`)}
        </p>
      ))}
    </div>
  );
}

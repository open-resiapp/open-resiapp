"use client";

// BYT-20261118-002 §4 — step "Oznámenie": announcement PDF + ballot lists
// (all owners, one page each; blank). Gated per regime + country by
// src/lib/legal-copy (signedOff.notice / .ballot — today SK HOA only); a
// pair whose wording is not signed off shows a "waiting for legal sign-off"
// state and NEVER falls back to the HOA statute text. Documents are
// regenerated from frozen data, not stored. Each board download records a
// `document_generated` event with the SHA-256 of the canonical input.
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card } from "@/components/ui";
import type { BallotData, BuildingInfo, VotingDetail } from "./types";
import { getLegalCopy } from "@/lib/legal-copy";

/** Per document: may it render for this community (legal-copy sign-off)? */
function documentGates(building: BuildingInfo | null, voting: VotingDetail) {
  if (!building || voting.votingType !== "written") {
    return { written: false, notice: false, ballot: false };
  }
  const lc = getLegalCopy(building.templateSlug, building.country);
  return { written: true, notice: lc.signedOff.notice, ballot: lc.signedOff.ballot };
}

/** Owner view: whether the announcement PDF may be offered. */
export function documentsAvailable(building: BuildingInfo | null, voting: VotingDetail): boolean {
  return documentGates(building, voting).notice;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable JSON (sorted keys) so the same data always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function useNoticeBuilder(voting: VotingDetail, building: BuildingInfo) {
  const t = useTranslations("VotingWorkflow");
  // Root translator for the regime keys (src/lib/legal-copy LegalCopyKeys).
  const tRoot = useTranslations();
  const lc = getLegalCopy(building.templateSlug, building.country);
  const format = useFormatter();
  const dateFmt = (d: string) =>
    format.dateTime(new Date(d), { day: "numeric", month: "long", year: "numeric" });
  const verifiers = (voting.officials ?? []).filter((o) => o.role === "verifier").map((o) => o.name);
  const chair = (voting.officials ?? []).find((o) => o.role === "chair")?.name;
  const items = [...(voting.items ?? [])]
    .sort((a, b) => a.idx - b.idx)
    .map((i) => ({ idx: i.idx, title: i.title, description: i.description }));
  const term = `${dateFmt(voting.startsAt)} – ${dateFmt(voting.endsAt)}`;

  const noticeData = {
    community: { name: building.name, address: building.address, ico: building.ico },
    announcedBy: chair ?? voting.createdBy?.name ?? "",
    term,
    place: voting.place ?? "",
    announcedOn: voting.announcedAt ? dateFmt(voting.announcedAt) : "",
    verifiers,
    electronicAllowed: voting.initiatedBy !== "owners_quarter",
    items,
  };
  const noticeLabels = {
    title: tRoot(lc.keys.noticeTitle),
    announcedBy: t("notice.announcedBy"),
    term: t("notice.term"),
    place: t("notice.place"),
    questions: t("notice.questions"),
    electronic: t("notice.electronic"),
    electronicText: t("notice.electronicText"),
    verifiers: t("notice.verifiers"),
    announcedOn: t("notice.announcedOn"),
    icoLabel: t("notice.ico"),
    legalBasis: tRoot(lc.keys.noticeLegalBasis),
  };
  const ballotData = { communityName: building.name, votingTitle: voting.title, term, items, verifiers };
  const ballotLabels = {
    title: tRoot(lc.keys.ballotHeading),
    term: t("ballotSheet.term"),
    owner: tRoot(lc.keys.ballotMemberLabel),
    units: t("ballotSheet.units"),
    for: t("ballotSheet.for"),
    against: t("ballotSheet.against"),
    abstain: t("ballotSheet.abstain"),
    dateAndSignature: t("ballotSheet.dateAndSignature"),
    verifier: t("ballotSheet.verifier"),
    unmarkedNote: t("ballotSheet.unmarkedNote"),
  };
  return { noticeData, noticeLabels, ballotData, ballotLabels };
}

/** Owner view: the single "Oznámenie (PDF)" link (no event, no officials shown). */
export function NoticeDownloadLink({ voting, building }: { voting: VotingDetail; building: BuildingInfo }) {
  const t = useTranslations("VotingWorkflow");
  const { noticeData, noticeLabels } = useNoticeBuilder(voting, building);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const [{ pdf }, { default: VotingNoticePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/voting/VotingNoticePDF"),
      ]);
      saveBlob(
        await pdf(<VotingNoticePDF data={noticeData} labels={noticeLabels} />).toBlob(),
        "oznamenie.pdf"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" onClick={download} loading={busy}>
      {t("docs.noticeLink")}
    </Button>
  );
}

export default function VotingDocuments({
  voting,
  data,
  building,
}: {
  voting: VotingDetail;
  data: BallotData | null;
  building: BuildingInfo;
}) {
  const t = useTranslations("VotingWorkflow");
  const tVoting = useTranslations("Voting");
  const { noticeData, noticeLabels, ballotData, ballotLabels } = useNoticeBuilder(voting, building);
  const [busy, setBusy] = useState<null | "notice" | "ballots" | "blank">(null);
  const [error, setError] = useState<string | null>(null);

  const gates = documentGates(building, voting);
  if (!gates.notice && !gates.ballot) {
    return (
      <Card as="section" className="mb-6">
        <h3 className="mb-2 text-lg font-bold text-ui-text">{t("docs.heading")}</h3>
        <p className="text-base text-ui-text-muted">
          {gates.written ? t("docs.pendingLegalSignoff") : t("docs.notAvailable")}
        </p>
      </Card>
    );
  }

  // One page per eligible OWNER; several units of one owner on one page.
  const ownerPages = (() => {
    const units = data?.overview?.items[0]?.units ?? [];
    const byOwner = new Map<string, { ownerName: string; units: string[] }>();
    for (const u of units) {
      for (const o of u.owners) {
        const slot = byOwner.get(o.ownerId) ?? { ownerName: o.ownerName ?? "", units: [] };
        slot.units.push(
          t("ballotSheet.unitLine", {
            unit: tVoting("flatHeader", { number: u.unitLabel }),
            share: `${o.shareNumerator}/${o.shareDenominator}`,
          })
        );
        byOwner.set(o.ownerId, slot);
      }
    }
    return Array.from(byOwner.values());
  })();

  async function record(doc: string, input: unknown) {
    const contentHash = await sha256Hex(canonical(input));
    await fetch(`/api/votings/${voting.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "document_generated", doc, contentHash }),
    }).catch(() => {});
  }

  async function download(kind: "notice" | "ballots" | "blank") {
    setBusy(kind);
    setError(null);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      if (kind === "notice") {
        const { default: VotingNoticePDF } = await import("@/components/voting/VotingNoticePDF");
        saveBlob(await pdf(<VotingNoticePDF data={noticeData} labels={noticeLabels} />).toBlob(), "oznamenie.pdf");
        await record("notice", noticeData);
      } else {
        const { default: VotingBallotPDF } = await import("@/components/voting/VotingBallotPDF");
        const owners = kind === "blank" ? [null] : ownerPages;
        saveBlob(
          await pdf(<VotingBallotPDF data={ballotData} owners={owners} labels={ballotLabels} />).toBlob(),
          kind === "blank" ? "hlasovacia-listina.pdf" : "hlasovacie-listiny.pdf"
        );
        await record(kind === "blank" ? "ballot_blank" : "ballots_all", { ballotData, owners });
      }
    } catch (err) {
      console.error("[voting] document generation failed:", err);
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" className="mb-6 space-y-3" aria-labelledby="voting-docs-heading">
      <h3 id="voting-docs-heading" className="text-lg font-bold text-ui-text">
        {t("docs.heading")}
      </h3>
      <p className="text-base text-ui-text-muted">{t("docs.signoffNote")}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {gates.notice && (
          <Button onClick={() => download("notice")} loading={busy === "notice"} disabled={busy !== null}>
            {t("docs.notice")}
          </Button>
        )}
        {gates.ballot && (
          <>
            <Button
              variant="secondary"
              onClick={() => download("ballots")}
              loading={busy === "ballots"}
              disabled={busy !== null || ownerPages.length === 0}
            >
              {t("docs.ballotsAll", { count: ownerPages.length })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => download("blank")}
              loading={busy === "blank"}
              disabled={busy !== null}
            >
              {t("docs.ballotBlank")}
            </Button>
          </>
        )}
      </div>
      {(!gates.notice || !gates.ballot) && (
        <p className="text-base text-ui-text-muted">{t("docs.pendingLegalSignoff")}</p>
      )}
      {error && (
        <p role="alert" className="text-base text-ui-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

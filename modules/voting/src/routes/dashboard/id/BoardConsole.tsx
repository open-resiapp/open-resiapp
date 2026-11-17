"use client";

// Board / admin part of the voting detail page (BYT-20261117-002 Phase 6
// split of the former 800-line page). Behaviour is unchanged: edit a draft,
// start / end, record paper ballots, create mandates, financial impacts,
// minutes PDF, paper ballot photos.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import MandateModal from "@/components/voting/MandateModal";
import PaperVoteModal from "@/components/voting/PaperVoteModal";
import DownloadMinutesButton from "@/components/voting/DownloadMinutesButton";
import VotingFinancialImpacts from "@modules/voting/src/ui/VotingFinancialImpacts";
import type { VotingStatus } from "@/types";
import type { BallotData, BuildingInfo, VotingDetail } from "./types";

// ── Start / end / edit actions under the header ─────────
export function ManageActions({
  voting,
  onEdit,
  onStatusChange,
}: {
  voting: VotingDetail;
  onEdit: () => void;
  onStatusChange: (status: VotingStatus) => void;
}) {
  const t = useTranslations("Voting");
  const tCommon = useTranslations("Common");
  if (voting.status !== "draft" && voting.status !== "active") return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-ui-border pt-4">
      {voting.status === "draft" && (
        <>
          <Button variant="secondary" onClick={onEdit}>
            {tCommon("edit")}
          </Button>
          <Button onClick={() => onStatusChange("active")}>{t("startVoting")}</Button>
        </>
      )}
      {voting.status === "active" && (
        <Button variant="danger" onClick={() => onStatusChange("closed")}>
          {t("endVoting")}
        </Button>
      )}
    </div>
  );
}

// ── Draft edit form (replaces the header while editing) ──
export function EditVotingForm({
  voting,
  onCancel,
  onSaved,
}: {
  voting: VotingDetail;
  onCancel: () => void;
  onSaved: (updated: VotingDetail) => void;
}) {
  const t = useTranslations("Voting");
  const tNew = useTranslations("VotingNew");
  const tCommon = useTranslations("Common");
  const [title, setTitle] = useState(voting.title);
  const [description, setDescription] = useState(voting.description || "");
  const [startsAt, setStartsAt] = useState(voting.startsAt.slice(0, 16));
  const [endsAt, setEndsAt] = useState(voting.endsAt.slice(0, 16));
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/votings/${voting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        startsAt,
        endsAt,
      }),
    });
    if (res.ok) {
      const refetch = await fetch(`/api/votings/${voting.id}`);
      if (refetch.ok) onSaved(await refetch.json());
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Field label={t("titleLabel")} required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label={t("descriptionLabel")}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tNew("startsAtLabel")} required>
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </Field>
        <Field label={tNew("endsAtLabel")} required>
          <Input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? tCommon("saving") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}

// ── Paper ballots, mandates, minutes, photos ────────────
export default function BoardConsole({
  votingId,
  voting,
  data,
  building,
  legalNotice,
  sessionUserId,
  canRecordPaper,
  canMandate,
  canManage,
  onRefresh,
  children,
}: {
  /** Rendered between the paper/mandate actions and the closed-voting tools (the results). */
  children?: React.ReactNode;
  votingId: string;
  voting: VotingDetail;
  data: BallotData | null;
  building: BuildingInfo | null;
  legalNotice: string | null;
  sessionUserId: string | null;
  canRecordPaper: boolean;
  canMandate: boolean;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("Voting");
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [showPaperModal, setShowPaperModal] = useState(false);

  const isActive = voting.status === "active";
  const isClosed = voting.status === "closed";

  return (
    <>
      {isActive && (canRecordPaper || canMandate) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {canRecordPaper && (
            <Button variant="secondary" onClick={() => setShowPaperModal(true)}>
              {t("recordPaperVote")}
            </Button>
          )}
          {canMandate && (
            <Button variant="secondary" onClick={() => setShowMandateModal(true)}>
              {t("delegateVote")}
            </Button>
          )}
        </div>
      )}

      {children}

      {/* Voting→accounting financial impacts (drafts + posted entries) */}
      {isClosed && canManage && <VotingFinancialImpacts votingId={votingId} />}

      {/* Per-item voting minutes */}
      {isClosed && canManage && data && building && (
        <div className="mt-6">
          <DownloadMinutesButton
            votingId={votingId}
            voting={voting}
            ballotData={data}
            building={building}
            legalNotice={legalNotice}
            entranceName={voting.entranceName}
          />
        </div>
      )}

      {/* Paper ballot photos (read from ballots) */}
      {canManage && data && data.ballots.some((b) => b.photos.length > 0) && (
        <Card as="section" className="mt-6">
          <h3 className="mb-4 text-lg font-bold text-ui-text">{t("paperVotePhotos")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.ballots.flatMap((b) =>
              b.photos.map((p) => (
                <a
                  key={`${b.id}-${p.idx}`}
                  href={p.storageKey}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-lg border border-ui-border hover:border-ui-border-strong"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.storageKey}
                    alt={`${b.ownerName} - ${b.flatNumber}`}
                    className="h-32 w-full object-cover"
                  />
                  <div className="p-2 text-sm text-ui-text-muted">
                    {b.ownerName} &middot; {t("flatHeader", { number: b.flatNumber })}
                  </div>
                </a>
              ))
            )}
          </div>
        </Card>
      )}

      <PaperVoteModal
        isOpen={showPaperModal}
        votingId={votingId}
        onClose={() => setShowPaperModal(false)}
        onRecorded={() => {
          setShowPaperModal(false);
          onRefresh();
        }}
      />

      {sessionUserId && (
        <MandateModal
          isOpen={showMandateModal}
          votingId={votingId}
          currentUserId={sessionUserId}
          onClose={() => setShowMandateModal(false)}
          onCreated={onRefresh}
        />
      )}
    </>
  );
}

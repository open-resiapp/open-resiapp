"use client";

// Board / admin part of the voting detail page (BYT-20261117-002 Phase 6
// split of the former 800-line page). Behaviour is unchanged: edit a draft,
// start / end, record paper ballots, create mandates, financial impacts,
// minutes PDF, paper ballot photos.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Field, Input, Textarea, useConfirm } from "@/components/ui";
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
  const confirm = useConfirm();
  if (voting.status !== "draft" && voting.status !== "active") return null;

  async function endVoting() {
    const ok = await confirm({
      title: t("endVotingConfirmTitle"),
      description: t("endVotingConfirmText"),
      confirmLabel: t("endVotingConfirmButton"),
      tone: "danger",
    });
    if (ok) onStatusChange("closed");
  }
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
        <Button variant="danger" onClick={endVoting}>
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
  const [paperPreset, setPaperPreset] = useState<{ ownerId: string; unitId: string } | null>(
    null
  );
  const participation = data?.participation ?? null;
  const turnoutPct =
    participation && participation.eligibleWeight > 0
      ? Math.round((participation.votedWeight / participation.eligibleWeight) * 1000) / 10
      : 0;

  const isActive = voting.status === "active";
  const isClosed = voting.status === "closed";

  return (
    <>
      {isActive && (canRecordPaper || canMandate) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {canRecordPaper && (
            <Button
              variant="secondary"
              onClick={() => {
                setPaperPreset(null);
                setShowPaperModal(true);
              }}
            >
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

      {/* Turnout + owners who have not voted yet (board / vote counter) */}
      {isActive && participation && (
        <Card as="section" className="mb-6 space-y-4">
          <h3 className="text-lg font-bold text-ui-text">{t("turnoutHeading")}</h3>
          <p className="text-base text-ui-text">
            {t("turnoutSummary", {
              voted: participation.votedCount,
              eligible: participation.eligibleCount,
              pct: turnoutPct,
            })}
          </p>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-ui-surface-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={turnoutPct}
            aria-label={t("turnoutHeading")}
          >
            <div
              className="h-full rounded-full bg-ui-primary"
              style={{ width: `${Math.min(100, turnoutPct)}%` }}
            />
          </div>
          {participation.notVoted.length === 0 ? (
            <p className="text-base text-ui-text-muted">{t("allVoted")}</p>
          ) : (
            <div>
              <h4 className="mb-2 text-base font-semibold text-ui-text">
                {t("notVotedHeading", { count: participation.notVoted.length })}
              </h4>
              <ul className="divide-y divide-ui-border">
                {participation.notVoted.map((r) => (
                  <li
                    key={`${r.unitId}-${r.ownerId}`}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-base font-medium text-ui-text">
                        {t("flatHeader", { number: r.unitLabel })}
                      </p>
                      <p className="break-words text-base text-ui-text-muted">
                        {r.ownerName ?? t("noOwnerName")}
                      </p>
                    </div>
                    {canRecordPaper && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setPaperPreset({ ownerId: r.ownerId, unitId: r.unitId });
                          setShowPaperModal(true);
                        }}
                      >
                        {t("recordPaperFor")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
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
        preset={paperPreset}
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

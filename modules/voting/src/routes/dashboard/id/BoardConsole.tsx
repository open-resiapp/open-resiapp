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
import ManagementOverview, { type OverviewFilter } from "./ManagementOverview";
import VotingDocuments from "./VotingDocuments";
import type { BallotData, BuildingInfo, VotingDetail } from "./types";

// Start / end / reopen / publish moved to ./WorkflowPanel (BYT-20261118-002).

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
  const tWorkflow = useTranslations("VotingWorkflow");
  const [overviewFilter, setOverviewFilter] = useState<OverviewFilter>("all");
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

      {/* Turnout + a one-line "not voted yet" jump to the drill-down (board / vote counter) */}
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
          ) : data?.overview ? (
            // One list only: the units are listed (with "Zapísať listinný
            // hlas") in the drill-down below — jump there, filter preset.
            <button
              type="button"
              className="min-h-11 text-left text-base font-medium text-ui-primary underline underline-offset-2"
              onClick={() => {
                setOverviewFilter("notVoted");
                document
                  .getElementById("voting-overview")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {tWorkflow("overview.notVotedJump", { count: participation.notVoted.length })}
            </button>
          ) : (
            <p className="text-base text-ui-text">
              {t("notVotedHeading", { count: participation.notVoted.length })}
            </p>
          )}
        </Card>
      )}

      {/* BYT-20261118-002 §5: per question → unit → owner drill-down. */}
      {(isActive || isClosed) && data?.overview && (
        <ManagementOverview
          data={data}
          filter={overviewFilter}
          onFilterChange={setOverviewFilter}
          canRecordPaper={canRecordPaper}
          isActive={isActive}
          onRecordPaper={(preset) => {
            setPaperPreset(preset);
            setShowPaperModal(true);
          }}
          onRefresh={onRefresh}
        />
      )}

      {/* BYT-20261118-002 §4: announcement + ballot lists (SK HOA only). */}
      {canManage && voting.status !== "draft" && building && (
        <VotingDocuments voting={voting} data={data} building={building} />
      )}

      {children}

      {/* Voting→accounting financial impacts (drafts + posted entries) */}
      {isClosed && canManage && <VotingFinancialImpacts votingId={votingId} />}

      {/* Minutes history (board): superseded versions flagged; download below only while closed */}
      {canManage && voting.minutes && voting.minutes.length > 0 && (
        <ul className="mt-6 space-y-1 text-base text-ui-text-muted">
          {voting.minutes.map((m, i) => (
            <li key={`${m.kind}-${m.version}-${i}`} className={m.superseded ? "line-through" : ""}>
              {m.superseded
                ? tWorkflow("minutesSuperseded", { version: m.version })
                : `v${m.version}`}
            </li>
          ))}
        </ul>
      )}

      {/* Per-item voting minutes — hidden while reopened (status active) */}
      {isClosed && canManage && data && building && (
        <div className="mt-6">
          <DownloadMinutesButton
            votingId={votingId}
            voting={voting}
            ballotData={data}
            building={building}
            legalNotice={legalNotice}
            entranceName={voting.entranceName}
            protocol={{
              place: voting.place ?? null,
              officials: (voting.officials ?? []).map((o) => ({
                role: o.role,
                name: o.name,
                refusedToSign: o.refusedToSign,
                refusalStatement: o.refusalStatement,
              })),
              events: voting.events ?? [],
              resultPublishedAt: voting.resultPublishedAt ?? null,
            }}
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

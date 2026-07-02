"use client";

import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import VoteButton from "@/components/voting/VoteButton";
import VotingResults from "@/components/voting/VotingResults";
import MandateModal from "@/components/voting/MandateModal";
import PaperVoteModal from "@/components/voting/PaperVoteModal";
import DownloadMinutesButton from "@/components/voting/DownloadMinutesButton";
import { hasPermission } from "@/lib/permissions";
import type {
  UserRole,
  VoteChoice,
  VotingStatus,
  VotingType,
  VotingInitiatedBy,
  QuorumType,
  VotingResults as VotingResultsType,
} from "@/types";
import ProjectDocsInline from "@/components/documents/ProjectDocsInline";

interface VotingDetail {
  id: string;
  title: string;
  description: string | null;
  status: VotingStatus;
  votingType: VotingType;
  initiatedBy: VotingInitiatedBy;
  startsAt: string;
  endsAt: string;
  voteCounterId: string | null;
  entranceId: string | null;
  entranceName: string | null;
  createdBy: { id: string; name: string } | null;
  documentProjectId: string | null;
}

// ── BYT-20260609-008 multi-item ballot shapes (from /api/ballots) ──
interface VotingItemRow {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
}
interface BallotChoice {
  itemId: string;
  choice: string;
  itemAuditHash: string;
}
interface BallotPhoto {
  storageKey: string;
  idx: number;
}
interface BallotRow {
  id: string;
  entityId: string;
  ownerId: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  ballotHash: string;
  recordedAt: string;
  disputed: boolean;
  choices: BallotChoice[];
  photos: BallotPhoto[];
}
interface UserBallot {
  ballotId: string;
  flatId: string;
  voteType: string;
  recordedAt: string;
  choices: Record<string, string>;
}
interface UserFlat {
  flatId: string;
  flatNumber: string;
}
interface BallotData {
  items: VotingItemRow[];
  results: (VotingResultsType & { itemId: string })[];
  ballots: BallotRow[];
  userBallots: UserBallot[];
  userFlats: UserFlat[];
  totalBallots: number;
  totalPossibleWeight: number;
}

const CHOICE_KEY: Record<VoteChoice, string> = {
  za: "for",
  proti: "against",
  zdrzal_sa: "abstain",
};
const CHOICES: VoteChoice[] = ["za", "proti", "zdrzal_sa"];

export default function VotingDetailPage() {
  const { data: session } = useSession();
  const t = useTranslations("Voting");
  const tNew = useTranslations("VotingNew");
  const tVote = useTranslations("VoteButton");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [voting, setVoting] = useState<VotingDetail | null>(null);
  const [data, setData] = useState<BallotData | null>(null);
  const [buildingData, setBuildingData] = useState<{ name: string; address: string; ico: string | null; country?: "sk" | "cz" } | null>(null);
  const [legalNotice, setLegalNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting404, setVoting404] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Per-flat ballot drafts (itemId → choice), the review step, and status.
  const [drafts, setDrafts] = useState<Record<string, Record<string, VoteChoice>>>({});
  const [reviewFlat, setReviewFlat] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [castError, setCastError] = useState("");
  const [lastBallotHash, setLastBallotHash] = useState<string | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const canVote = hasPermission(role, "vote");
  const canRecordPaper = hasPermission(role, "recordPaperVote");
  const canMandate = hasPermission(role, "grantMandate");
  const canManage = hasPermission(role, "createVoting");

  const fetchVoteData = useCallback(async () => {
    if (!hasPermission(role, "viewVotingResults")) return;
    const res = await fetch(`/api/ballots?votingId=${id}`);
    if (res.ok) {
      const d: BallotData = await res.json();
      setData(d);
      // Prefill drafts from any existing ballots so re-editing shows prior choices.
      const init: Record<string, Record<string, VoteChoice>> = {};
      for (const ub of d.userBallots) {
        init[ub.flatId] = { ...(ub.choices as Record<string, VoteChoice>) };
      }
      setDrafts(init);
    }
  }, [id, role]);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/votings/${id}`);
      if (res.status === 404) {
        setVoting404(true);
        setLoading(false);
        return;
      }
      if (res.ok) {
        setVoting(await res.json());
      }
      const buildingRes = await fetch("/api/building");
      if (buildingRes.ok) {
        const bldData = await buildingRes.json();
        if (bldData) {
          setBuildingData({
            name: bldData.name,
            address: bldData.address,
            ico: bldData.ico,
            country: bldData.country,
          });
          if (bldData.legalNotice) setLegalNotice(bldData.legalNotice);
        }
      }
      await fetchVoteData();
      setLoading(false);
    }
    load();
  }, [id, fetchVoteData]);

  function setChoice(flatId: string, itemId: string, choice: VoteChoice) {
    setDrafts((prev) => ({
      ...prev,
      [flatId]: { ...(prev[flatId] || {}), [itemId]: choice },
    }));
  }
  function bulkSetRemaining(flatId: string, choice: VoteChoice) {
    if (!data) return;
    setDrafts((prev) => {
      const cur = { ...(prev[flatId] || {}) };
      for (const item of data.items) if (!cur[item.id]) cur[item.id] = choice;
      return { ...prev, [flatId]: cur };
    });
  }

  async function submitBallot(flatId: string) {
    setSubmitting(true);
    setCastError("");
    const cur = drafts[flatId] || {};
    const items = Object.entries(cur).map(([itemId, choice]) => ({ itemId, choice }));
    const res = await fetch("/api/ballots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingId: id, flatId, items }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.ballotHash) setLastBallotHash(j.ballotHash);
      setReviewFlat(null);
      await fetchVoteData();
    } else {
      const e = await res.json().catch(() => ({}));
      setCastError(e.error || t("signSubmitFailed"));
    }
    setSubmitting(false);
  }

  async function withdrawBallot(flatId: string) {
    if (!window.confirm(t("withdrawConfirm"))) return;
    const res = await fetch(`/api/ballots?votingId=${id}&flatId=${flatId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setReviewFlat(null);
      await fetchVoteData();
    }
  }

  async function handleStatusChange(status: VotingStatus) {
    await fetch(`/api/votings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const res = await fetch(`/api/votings/${id}`);
    if (res.ok) setVoting(await res.json());
  }

  function startEditing() {
    if (!voting) return;
    setEditTitle(voting.title);
    setEditDescription(voting.description || "");
    setEditStartsAt(voting.startsAt.slice(0, 16));
    setEditEndsAt(voting.endsAt.slice(0, 16));
    setEditMode(true);
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    setEditSaving(true);
    const res = await fetch(`/api/votings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle,
        description: editDescription || null,
        startsAt: editStartsAt,
        endsAt: editEndsAt,
      }),
    });
    if (res.ok) {
      const refetch = await fetch(`/api/votings/${id}`);
      if (refetch.ok) setVoting(await refetch.json());
      setEditMode(false);
    }
    setEditSaving(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-2/3 dark:bg-gray-700" />
        <div className="h-4 bg-gray-200 rounded w-full dark:bg-gray-700" />
        <div className="h-32 bg-gray-200 rounded dark:bg-gray-700" />
      </div>
    );
  }

  if (voting404 || !voting) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-500 mb-4 dark:text-gray-400">{t("notFound")}</p>
        <button
          onClick={() => router.push("/voting")}
          className="text-blue-600 hover:underline text-base dark:text-blue-400"
        >
          {tCommon("backToList")}
        </button>
      </div>
    );
  }

  const isActive = voting.status === "active";
  const isClosed = voting.status === "closed";
  const isMeetingOrOwnersQuarter =
    voting.votingType === "meeting" || voting.initiatedBy === "owners_quarter";

  const items = data?.items || [];
  const userFlats = data?.userFlats || [];
  const userBallots = data?.userBallots || [];
  const hasVotedAllFlats =
    userFlats.length > 0 &&
    userFlats.every((f) => userBallots.some((b) => b.flatId === f.flatId));

  const flatNumbers = Object.fromEntries(
    (data?.ballots || []).map((b) => [b.entityId, b.flatNumber])
  );

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block dark:text-blue-400"
      >
        &larr; {tCommon("backToList")}
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 dark:bg-gray-800 dark:border-gray-700">
        {!editMode ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{voting.title}</h1>
              <div className="flex gap-2 flex-shrink-0 flex-wrap">
                {voting.entranceName && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {voting.entranceName}
                  </span>
                )}
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                    voting.votingType === "meeting"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                  }`}
                >
                  {voting.votingType === "meeting" ? t("typeMeeting") : t("typeWritten")}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                    isActive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                      : isClosed
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
                      : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {isActive ? t("statusActive") : isClosed ? t("statusClosed") : t("statusDraft")}
                </span>
              </div>
            </div>

            {voting.description && (
              <p className="text-base text-gray-700 mb-4 whitespace-pre-wrap dark:text-gray-200">
                {voting.description}
              </p>
            )}

            {voting.documentProjectId && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2 dark:text-gray-200">
                  {t("attachedProjectDocs")}
                </p>
                <ProjectDocsInline projectId={voting.documentProjectId} />
              </div>
            )}

            {legalNotice && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-900/30 dark:border-blue-800">
                <p className="text-sm font-medium text-blue-800 mb-1 dark:text-blue-200">{t("legalNotice")}</p>
                <p className="text-sm text-blue-700 whitespace-pre-wrap dark:text-blue-200">{legalNotice}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>
                {t("from")}{" "}
                {format.dateTime(new Date(voting.startsAt), { day: "numeric", month: "long", year: "numeric" })}
              </span>
              <span>
                {t("to")}{" "}
                {format.dateTime(new Date(voting.endsAt), { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>

            {canManage && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                {voting.status === "draft" && (
                  <>
                    <button
                      onClick={startEditing}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-base rounded-lg transition-colors"
                    >
                      {tCommon("edit")}
                    </button>
                    <button
                      onClick={() => handleStatusChange("active")}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-base rounded-lg transition-colors"
                    >
                      {t("startVoting")}
                    </button>
                  </>
                )}
                {voting.status === "active" && (
                  <button
                    onClick={() => handleStatusChange("closed")}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-base rounded-lg transition-colors"
                  >
                    {t("endVoting")}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleEditSave} className="space-y-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("titleLabel")}
              </label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("descriptionLabel")}
              </label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {tNew("startsAtLabel")}
                </label>
                <input
                  type="datetime-local"
                  value={editStartsAt}
                  onChange={(e) => setEditStartsAt(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {tNew("endsAtLabel")}
                </label>
                <input
                  type="datetime-local"
                  value={editEndsAt}
                  onChange={(e) => setEditEndsAt(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {editSaving ? tCommon("saving") : tCommon("save")}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Meeting / owners_quarter info message */}
      {isActive && isMeetingOrOwnersQuarter && canVote && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6 text-center dark:bg-amber-900/30 dark:border-amber-800">
          <p className="text-base text-amber-800 dark:text-amber-200">
            {voting.votingType === "meeting" ? t("meetingOnlyInfo") : t("ownersQuarterInfo")}
          </p>
        </div>
      )}

      {/* Per-flat multi-item ballot: mark every item, then sign once. */}
      {isActive && canVote && !isMeetingOrOwnersQuarter && userFlats.length > 0 && items.length > 0 && (
        <div className="space-y-4 mb-6">
          {castError && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base dark:bg-red-900/30 dark:text-red-200">
              {castError}
            </div>
          )}
          {userFlats.map((flat) => {
            const cur = drafts[flat.flatId] || {};
            const markedCount = Object.keys(cur).length;
            const remaining = items.length - markedCount;
            const existing = userBallots.find((b) => b.flatId === flat.flatId);
            const inReview = reviewFlat === flat.flatId;

            return (
              <div
                key={flat.flatId}
                className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-gray-800 dark:border-gray-700"
              >
                <h3 className="text-lg font-bold text-gray-900 mb-1 dark:text-gray-100">
                  {t("flatHeader", { number: flat.flatNumber })}
                </h3>

                {existing && (
                  <p className="text-sm text-green-700 mb-3 dark:text-green-300">
                    {t("alreadySignedHint", {
                      date: format.dateTime(new Date(existing.recordedAt), {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </p>
                )}

                {!inReview ? (
                  <>
                    <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
                      {t("ballotIntro")}
                    </p>

                    <div className="space-y-5">
                      {items.map((item) => (
                        <div key={item.id}>
                          <div className="mb-2">
                            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
                              {item.idx + 1}. {item.title}
                            </span>
                            {item.description && (
                              <p className="text-sm text-gray-500 whitespace-pre-wrap dark:text-gray-400">
                                {item.description}
                              </p>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {CHOICES.map((c) => (
                              <VoteButton
                                key={c}
                                choice={c}
                                selected={cur[item.id] === c}
                                disabled={submitting}
                                onClick={(choice) => setChoice(flat.flatId, item.id, choice)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Bulk set remaining */}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-gray-500 mb-2 dark:text-gray-400">
                        {t("setRemainingLabel")}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {CHOICES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            disabled={submitting || remaining === 0}
                            onClick={() => bulkSetRemaining(flat.flatId, c)}
                            className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-700 dark:text-gray-200"
                          >
                            {tVote(CHOICE_KEY[c])}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {remaining > 0
                          ? t("remainingToMark", { count: remaining })
                          : t("allItemsMarked")}
                      </span>
                      <div className="flex gap-2">
                        {existing && (
                          <button
                            type="button"
                            onClick={() => withdrawBallot(flat.flatId)}
                            className="px-4 py-3 text-base font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors dark:text-red-300 dark:bg-red-900/30 dark:hover:bg-red-900/50"
                          >
                            {t("withdrawBallot")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={submitting || markedCount === 0}
                          onClick={() => {
                            setCastError("");
                            setReviewFlat(flat.flatId);
                          }}
                          className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
                        >
                          {t("reviewAndSign")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h4 className="text-base font-bold text-gray-900 mb-1 dark:text-gray-100">
                      {t("reviewTitle")}
                    </h4>
                    <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
                      {t("reviewHelp")}
                    </p>
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700 mb-4">
                      {items.map((item) => {
                        const choice = cur[item.id] as VoteChoice | undefined;
                        return (
                          <li key={item.id} className="flex items-center justify-between py-2 gap-3">
                            <span className="text-base text-gray-800 dark:text-gray-200">
                              {item.idx + 1}. {item.title}
                            </span>
                            <span
                              className={`text-sm font-semibold whitespace-nowrap ${
                                choice
                                  ? "text-gray-900 dark:text-gray-100"
                                  : "text-amber-600 dark:text-amber-300"
                              }`}
                            >
                              {choice ? tVote(CHOICE_KEY[choice]) : t("unmarkedItem")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setReviewFlat(null)}
                        className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
                      >
                        {tCommon("cancel")}
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submitBallot(flat.flatId)}
                        className="px-5 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-base font-medium rounded-lg transition-colors"
                      >
                        {submitting ? t("signing") : t("confirmSign")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ballot hash display */}
      {lastBallotHash && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 dark:bg-gray-800 dark:border-gray-700">
          <p className="text-sm text-gray-500 mb-1 dark:text-gray-400">{t("ballotHashLabel")}</p>
          <p className="text-xs font-mono text-gray-700 break-all dark:text-gray-200">
            {lastBallotHash}
          </p>
        </div>
      )}

      {/* Action buttons */}
      {isActive && (canRecordPaper || canMandate) && (
        <div className="flex flex-wrap gap-3 mb-6">
          {canRecordPaper && (
            <button
              onClick={() => setShowPaperModal(true)}
              className="px-5 py-3 bg-amber-600 hover:bg-amber-700 text-white text-base font-medium rounded-lg transition-colors"
            >
              {t("recordPaperVote")}
            </button>
          )}
          {canMandate && (
            <button
              onClick={() => setShowMandateModal(true)}
              className="px-5 py-3 bg-purple-600 hover:bg-purple-700 text-white text-base font-medium rounded-lg transition-colors"
            >
              {t("delegateVote")}
            </button>
          )}
        </div>
      )}

      {/* Per-item results */}
      {data && (isClosed || hasVotedAllFlats || canManage) && items.length > 0 && (
        <div className="space-y-6">
          {items.map((item) => {
            const r = data.results.find((x) => x.itemId === item.id);
            if (!r) return null;
            const totalVotes = data.ballots.filter((b) =>
              b.choices.some((c) => c.itemId === item.id)
            ).length;
            return (
              <div key={item.id}>
                <div className="mb-2">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {item.idx + 1}. {item.title}
                  </h3>
                  {item.description && (
                    <p className="text-sm text-gray-500 whitespace-pre-wrap dark:text-gray-400">
                      {item.description}
                    </p>
                  )}
                </div>
                <VotingResults
                  results={r}
                  totalVotes={totalVotes}
                  flatNumbers={flatNumbers}
                  country={buildingData?.country ?? "sk"}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Per-item voting minutes */}
      {isClosed && canManage && data && buildingData && (
        <div className="mt-6">
          <DownloadMinutesButton
            votingId={id}
            voting={voting}
            ballotData={data}
            building={buildingData}
            legalNotice={legalNotice}
            entranceName={voting.entranceName}
          />
        </div>
      )}

      {/* Paper ballot photos (read from ballots) */}
      {canManage && data && data.ballots.some((b) => b.photos.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6 dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 mb-4 dark:text-gray-100">
            {t("paperVotePhotos")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {data.ballots.flatMap((b) =>
              b.photos.map((p) => (
                <a
                  key={`${b.id}-${p.idx}`}
                  href={p.storageKey}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-colors dark:border-gray-700 dark:hover:border-blue-500"
                >
                  <img src={p.storageKey} alt={`${b.ownerName} - ${b.flatNumber}`} className="w-full h-32 object-cover" />
                  <div className="p-2 text-sm text-gray-600 dark:text-gray-300">
                    {b.ownerName} &middot; {t("flatHeader", { number: b.flatNumber })}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      )}

      <PaperVoteModal
        isOpen={showPaperModal}
        votingId={id}
        onClose={() => setShowPaperModal(false)}
        onRecorded={() => {
          setShowPaperModal(false);
          fetchVoteData();
        }}
      />

      {session && (
        <MandateModal
          isOpen={showMandateModal}
          votingId={id}
          currentUserId={session.user.id}
          onClose={() => setShowMandateModal(false)}
          onCreated={fetchVoteData}
        />
      )}
    </div>
  );
}

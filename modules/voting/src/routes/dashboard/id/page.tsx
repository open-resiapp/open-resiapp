"use client";

import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import VoteButton from "@/components/voting/VoteButton";
import VotingResults from "@/components/voting/VotingResults";
import PaperVoteModal from "@/components/voting/PaperVoteModal";
import MandateModal from "@/components/voting/MandateModal";
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

interface VotingDetail {
  id: string;
  title: string;
  description: string | null;
  status: VotingStatus;
  votingType: VotingType;
  initiatedBy: VotingInitiatedBy;
  quorumType: QuorumType;
  startsAt: string;
  endsAt: string;
  voteCounterId: string | null;
  entranceId: string | null;
  entranceName: string | null;
  createdBy: { id: string; name: string } | null;
}

interface UserFlatVote {
  flatId: string;
  choice: string;
}

interface UserFlat {
  flatId: string;
  flatNumber: string;
}

interface VoteRow {
  id: string;
  flatId: string;
  ownerId: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  paperPhotoUrl: string | null;
  choice: string;
  createdAt: string;
  auditHash: string;
}

interface VoteData {
  votes: VoteRow[];
  results: VotingResultsType;
  userVotedFlats: UserFlatVote[];
  userFlats: UserFlat[];
  totalVotes: number;
}

export default function VotingDetailPage() {
  const { data: session } = useSession();
  const t = useTranslations("Voting");
  const tNew = useTranslations("VotingNew");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [voting, setVoting] = useState<VotingDetail | null>(null);
  const [voteData, setVoteData] = useState<VoteData | null>(null);
  const [buildingData, setBuildingData] = useState<{ name: string; address: string; ico: string | null } | null>(null);
  const [legalNotice, setLegalNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting404, setVoting404] = useState(false);
  const [castingVote, setCastingVote] = useState(false);
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [lastAuditHash, setLastAuditHash] = useState<string | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const canVote = hasPermission(role, "vote");
  const canRecordPaper = hasPermission(role, "recordPaperVote");
  const canMandate = hasPermission(role, "grantMandate");
  const canManage = hasPermission(role, "createVoting");

  const fetchVoteData = useCallback(async () => {
    if (!hasPermission(role, "viewVotingResults")) return;
    const res = await fetch(`/api/votes?votingId=${id}`);
    if (res.ok) {
      setVoteData(await res.json());
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
          setBuildingData({ name: bldData.name, address: bldData.address, ico: bldData.ico });
          if (bldData.legalNotice) {
            setLegalNotice(bldData.legalNotice);
          }
        }
      }
      await fetchVoteData();
      setLoading(false);
    }
    load();
  }, [id, fetchVoteData]);

  async function handleVote(choice: VoteChoice, flatId: string) {
    if (!canVote || voting?.status !== "active") return;

    // Skip if already voted with the same choice
    const existing = userVotedFlats.find((v) => v.flatId === flatId);
    if (existing && existing.choice === choice) return;

    setCastingVote(true);
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingId: id, choice, flatId }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.auditHash) {
        setLastAuditHash(data.auditHash);
      }
      await fetchVoteData();
    }
    setCastingVote(false);
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
        <div className="h-8 bg-gray-200 rounded w-2/3" />
        <div className="h-4 bg-gray-200 rounded w-full" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  if (voting404 || !voting) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-500 mb-4">{t("notFound")}</p>
        <button
          onClick={() => router.push("/voting")}
          className="text-blue-600 hover:underline text-base"
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

  // Per-flat voting data
  const userFlats = voteData?.userFlats || [];
  const userVotedFlats = voteData?.userVotedFlats || [];
  const hasVotedAllFlats =
    userFlats.length > 0 &&
    userFlats.every((f) =>
      userVotedFlats.some((v) => v.flatId === f.flatId)
    );

  const getFlatVote = (flatId: string) =>
    userVotedFlats.find((v) => v.flatId === flatId);

  // Check if a flat was voted by someone else (co-owner)
  const isFlatVotedByOther = (flatId: string) => {
    const vote = getFlatVote(flatId);
    return (
      !vote &&
      (voteData?.votes as Array<{ flatId: string }>)?.some(
        (v) => v.flatId === flatId
      )
    );
  };

  const getChoiceKey = (choice: string) =>
    choice === "za"
      ? "votedFor"
      : choice === "proti"
      ? "votedAgainst"
      : "votedAbstain";

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; {tCommon("backToList")}
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        {!editMode ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">{voting.title}</h1>
              <div className="flex gap-2 flex-shrink-0 flex-wrap">
                {/* Entrance badge */}
                {voting.entranceName && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap bg-gray-100 text-gray-600">
                    {voting.entranceName}
                  </span>
                )}
                {/* Voting type badge */}
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                    voting.votingType === "meeting"
                      ? "bg-purple-100 text-purple-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {voting.votingType === "meeting"
                    ? t("typeMeeting")
                    : t("typeWritten")}
                </span>
                {/* Status badge */}
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                    isActive
                      ? "bg-green-100 text-green-700"
                      : isClosed
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {isActive
                    ? t("statusActive")
                    : isClosed
                    ? t("statusClosed")
                    : t("statusDraft")}
                </span>
              </div>
            </div>

            {voting.description && (
              <p className="text-base text-gray-700 mb-4 whitespace-pre-wrap">
                {voting.description}
              </p>
            )}

            {legalNotice && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-800 mb-1">{t("legalNotice")}</p>
                <p className="text-sm text-blue-700 whitespace-pre-wrap">{legalNotice}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>
                {t("from")}{" "}
                {format.dateTime(new Date(voting.startsAt), {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span>
                {t("to")}{" "}
                {format.dateTime(new Date(voting.endsAt), {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>

            {canManage && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
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
              <label className="block text-base font-medium text-gray-700 mb-1">
                {t("titleLabel")}
              </label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                {t("descriptionLabel")}
              </label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {tNew("startsAtLabel")}
                </label>
                <input
                  type="datetime-local"
                  value={editStartsAt}
                  onChange={(e) => setEditStartsAt(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1">
                  {tNew("endsAtLabel")}
                </label>
                <input
                  type="datetime-local"
                  value={editEndsAt}
                  onChange={(e) => setEditEndsAt(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
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
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6 text-center">
          <p className="text-base text-amber-800">
            {voting.votingType === "meeting"
              ? t("meetingOnlyInfo")
              : t("ownersQuarterInfo")}
          </p>
        </div>
      )}

      {/* Per-flat voting sections */}
      {isActive && canVote && !isMeetingOrOwnersQuarter && userFlats.length > 0 && (
        <div className="space-y-4 mb-6">
          {userFlats.map((flat) => {
            const flatVote = getFlatVote(flat.flatId);
            const votedByOther = isFlatVotedByOther(flat.flatId);

            return (
              <div
                key={flat.flatId}
                className="bg-white rounded-xl border border-gray-200 p-6"
              >
                <h3 className="text-lg font-bold text-gray-900 mb-3">
                  {t("flatHeader", { number: flat.flatNumber })}
                </h3>

                {votedByOther ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                    <p className="text-base text-amber-700">
                      {t("flatVotedByOther")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-base text-gray-600 mb-2">
                      {flatVote
                        ? t("changeVoteHint")
                        : t("castVote", { flatNumber: flat.flatNumber })}
                    </p>
                    <VoteButton
                      choice="za"
                      selected={flatVote?.choice === "za"}
                      disabled={castingVote}
                      onClick={(choice) => handleVote(choice, flat.flatId)}
                    />
                    <VoteButton
                      choice="proti"
                      selected={flatVote?.choice === "proti"}
                      disabled={castingVote}
                      onClick={(choice) => handleVote(choice, flat.flatId)}
                    />
                    <VoteButton
                      choice="zdrzal_sa"
                      selected={flatVote?.choice === "zdrzal_sa"}
                      disabled={castingVote}
                      onClick={(choice) => handleVote(choice, flat.flatId)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Audit hash display */}
      {lastAuditHash && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-gray-500 mb-1">{t("auditHashLabel")}</p>
          <p className="text-xs font-mono text-gray-700 break-all">
            {lastAuditHash}
          </p>
        </div>
      )}

      {/* Action buttons */}
      {isActive && (
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

      {/* Results */}
      {voteData && (isClosed || hasVotedAllFlats || canManage) && (
        <VotingResults
          results={voteData.results}
          totalVotes={voteData.totalVotes}
        />
      )}

      {/* Download minutes button */}
      {isClosed && canManage && voteData && buildingData && (
        <div className="mt-6">
          <DownloadMinutesButton
            votingId={id}
            voting={voting}
            voteData={voteData}
            building={buildingData}
            legalNotice={legalNotice}
            entranceName={voting.entranceName}
          />
        </div>
      )}

      {/* Paper vote photos */}
      {canManage && voteData && voteData.votes.some((v) => v.paperPhotoUrl) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            {t("paperVotePhotos")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {voteData.votes
              .filter((v) => v.paperPhotoUrl)
              .map((v) => (
                <a
                  key={v.id}
                  href={v.paperPhotoUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-colors"
                >
                  <img
                    src={v.paperPhotoUrl!}
                    alt={`${v.ownerName} - ${v.flatNumber}`}
                    className="w-full h-32 object-cover"
                  />
                  <div className="p-2 text-sm text-gray-600">
                    {v.ownerName} &middot; {t("flatHeader", { number: v.flatNumber })}
                  </div>
                </a>
              ))}
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

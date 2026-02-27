"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import VoteButton from "@/components/voting/VoteButton";
import VotingResults from "@/components/voting/VotingResults";
import PaperVoteModal from "@/components/voting/PaperVoteModal";
import MandateModal from "@/components/voting/MandateModal";
import { hasPermission } from "@/lib/permissions";
import type {
  UserRole,
  VoteChoice,
  VotingStatus,
  VotingResults as VotingResultsType,
} from "@/types";

interface VotingDetail {
  id: string;
  title: string;
  description: string | null;
  status: VotingStatus;
  startsAt: string;
  endsAt: string;
  voteCounterId: string | null;
  createdBy: { id: string; name: string } | null;
}

interface VoteData {
  votes: unknown[];
  results: VotingResultsType;
  userVote: { id: string; choice: VoteChoice } | null;
  totalVotes: number;
}

export default function VotingDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [voting, setVoting] = useState<VotingDetail | null>(null);
  const [voteData, setVoteData] = useState<VoteData | null>(null);
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
      await fetchVoteData();
      setLoading(false);
    }
    load();
  }, [id, fetchVoteData]);

  async function handleVote(choice: VoteChoice) {
    if (!canVote || voteData?.userVote || voting?.status !== "active") return;

    setCastingVote(true);
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingId: id, choice }),
    });

    if (res.ok) {
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
        <p className="text-lg text-gray-500 mb-4">Hlasovanie nenájdené.</p>
        <button
          onClick={() => router.push("/voting")}
          className="text-blue-600 hover:underline text-base"
        >
          Späť na zoznam
        </button>
      </div>
    );
  }

  const isActive = voting.status === "active";
  const isClosed = voting.status === "closed";
  const hasVoted = !!voteData?.userVote;

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; Späť na zoznam
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        {!editMode ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">{voting.title}</h1>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                  isActive
                    ? "bg-green-100 text-green-700"
                    : isClosed
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {isActive ? "Aktívne" : isClosed ? "Ukončené" : "Návrh"}
              </span>
            </div>

            {voting.description && (
              <p className="text-base text-gray-700 mb-4 whitespace-pre-wrap">
                {voting.description}
              </p>
            )}

            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>
                Od:{" "}
                {new Date(voting.startsAt).toLocaleDateString("sk-SK", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span>
                Do:{" "}
                {new Date(voting.endsAt).toLocaleDateString("sk-SK", {
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
                      Upraviť
                    </button>
                    <button
                      onClick={() => handleStatusChange("active")}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-base rounded-lg transition-colors"
                    >
                      Spustiť hlasovanie
                    </button>
                  </>
                )}
                {voting.status === "active" && (
                  <button
                    onClick={() => handleStatusChange("closed")}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-base rounded-lg transition-colors"
                  >
                    Ukončiť hlasovanie
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleEditSave} className="space-y-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Názov
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
                Popis
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
                  Začiatok
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
                  Koniec
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
                Zrušiť
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {editSaving ? "Ukladám..." : "Uložiť"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Voting buttons */}
      {isActive && canVote && !hasVoted && (
        <div className="space-y-3 mb-6">
          <h3 className="text-lg font-bold text-gray-900">Odovzdajte svoj hlas</h3>
          <VoteButton
            choice="za"
            disabled={castingVote}
            onClick={handleVote}
          />
          <VoteButton
            choice="proti"
            disabled={castingVote}
            onClick={handleVote}
          />
          <VoteButton
            choice="zdrzal_sa"
            disabled={castingVote}
            onClick={handleVote}
          />
        </div>
      )}

      {/* User already voted */}
      {hasVoted && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6 text-center">
          <p className="text-lg font-bold text-blue-700">
            Hlasovali ste:{" "}
            {voteData.userVote!.choice === "za"
              ? "ZA"
              : voteData.userVote!.choice === "proti"
              ? "PROTI"
              : "ZDRŽAL SA"}{" "}
            ✓
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
              📄 Zaznamenať listinný hlas
            </button>
          )}
          {canMandate && !hasVoted && (
            <button
              onClick={() => setShowMandateModal(true)}
              className="px-5 py-3 bg-purple-600 hover:bg-purple-700 text-white text-base font-medium rounded-lg transition-colors"
            >
              Delegovať hlas
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {voteData && (isClosed || hasVoted || canManage) && (
        <VotingResults
          results={voteData.results}
          totalVotes={voteData.totalVotes}
        />
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

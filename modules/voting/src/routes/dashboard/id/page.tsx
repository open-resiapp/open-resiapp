"use client";

// Voting detail. BYT-20261117-002 Phase 6 split the former single page into
// the shared header + results here, the owner cast flow (OwnerBallot) and
// the board / admin console (BoardConsole).
import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import VotingResults from "@/components/voting/VotingResults";
import ResultPresence from "./ResultPresence";
import { hasPermission } from "@/lib/permissions";
import ProjectDocsInline from "@/components/documents/ProjectDocsInline";
import { Badge, Button, Card, Icon, LoadingBlock } from "@/components/ui";
import type { UserRole } from "@/types";
import { useShell } from "@/components/layout/ShellContext";
import { canRecordForVotingClient } from "@modules/voting/src/counter-authz";
import OwnerBallot from "./OwnerBallot";
import BoardConsole, { EditVotingForm } from "./BoardConsole";
import WorkflowPanel from "./WorkflowPanel";
import { MeetingBoardPanel, MeetingOwnerCard } from "./MeetingPanel";
import { NoticeDownloadLink, documentsAvailable } from "./VotingDocuments";
import type { BallotData, BuildingInfo, VotingDetail } from "./types";

export default function VotingDetailPage({
  canManage,
}: {
  /** Admin OR active chairman (assertBoard, BYT-20261117-001 Decided 1) — resolved server-side. */
  canManage: boolean;
}) {
  const { data: session } = useSession();
  const t = useTranslations("Voting");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [voting, setVoting] = useState<VotingDetail | null>(null);
  const [data, setData] = useState<BallotData | null>(null);
  // Community data comes from the server-resolved shell (no /api/building fetch).
  const { community, user: shellUser } = useShell();
  const buildingData = useMemo<BuildingInfo | null>(
    () =>
      community
        ? {
            name: community.name,
            address: community.address ?? "",
            ico: community.ico,
            country: community.country ?? undefined,
            templateSlug: community.templateSlug,
          }
        : null,
    [community]
  );
  const legalNotice = community?.legalNotice ?? null;
  const [loading, setLoading] = useState(true);
  const [voting404, setVoting404] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const role = (session?.user?.role || "owner") as UserRole;
  const canVote = hasPermission(role, "vote");
  // Per voting: admin, active chairman or this voting's own counter (mirrors server).
  const canRecordPaper = canRecordForVotingClient(shellUser, voting);
  const canMandate = hasPermission(role, "grantMandate");

  const fetchBallots = useCallback(async (): Promise<BallotData | null> => {
    if (!hasPermission(role, "viewVotingResults")) return null;
    const res = await fetch(`/api/ballots?votingId=${id}`);
    return res.ok ? ((await res.json()) as BallotData) : null;
  }, [id, role]);

  const fetchVoteData = useCallback(async () => {
    const ballots = await fetchBallots();
    if (ballots) setData(ballots);
  }, [fetchBallots]);

  useEffect(() => {
    async function load() {
      // Independent requests — run in parallel.
      const [votingRes, ballots] = await Promise.all([
        fetch(`/api/votings/${id}`),
        fetchBallots().catch(() => null),
      ]);
      if (votingRes.status === 404) {
        setVoting404(true);
        setLoading(false);
        return;
      }
      if (votingRes.ok) setVoting(await votingRes.json());
      if (ballots) setData(ballots);
      setLoading(false);
    }
    load();
  }, [id, fetchBallots]);

  // BYT-20261118-002: one refetch after the board's own action (no polling).
  async function refetchVoting() {
    const res = await fetch(`/api/votings/${id}`);
    if (res.ok) setVoting(await res.json());
    await fetchVoteData();
  }

  if (loading) {
    return <LoadingBlock />;
  }

  if (voting404 || !voting) {
    return (
      <div className="py-12 text-center">
        <p className="mb-4 text-lg text-ui-text-muted">{t("notFound")}</p>
        <Button variant="secondary" onClick={() => router.push("/voting")}>
          {tCommon("backToList")}
        </Button>
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
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" className="mb-4" onClick={() => router.push("/voting")}>
        <Icon name="chevronLeft" size={20} />
        {tCommon("backToList")}
      </Button>

      <Card as="section" className="mb-6">
        {editMode && canManage ? (
          <EditVotingForm
            voting={voting}
            onCancel={() => setEditMode(false)}
            onSaved={(updated) => {
              setVoting(updated);
              setEditMode(false);
            }}
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h1 className="min-w-0 break-words text-2xl font-bold text-ui-text">
                {voting.title}
              </h1>
              <div className="flex min-w-0 flex-wrap gap-2">
                {voting.entranceName && <Badge tone="neutral">{voting.entranceName}</Badge>}
                <Badge tone="info">
                  {voting.votingType === "meeting" ? t("typeMeeting") : t("typeWritten")}
                </Badge>
                <Badge tone={isActive ? "success" : isClosed ? "danger" : "neutral"}>
                  {isActive ? t("statusActive") : isClosed ? t("statusClosed") : t("statusDraft")}
                </Badge>
              </div>
            </div>

            {voting.description && (
              <p className="mb-4 whitespace-pre-wrap break-words text-base text-ui-text">
                {voting.description}
              </p>
            )}

            {voting.documentProjectId && (
              <div className="mb-4">
                <p className="mb-2 text-base font-medium text-ui-text">
                  {t("attachedProjectDocs")}
                </p>
                <ProjectDocsInline projectId={voting.documentProjectId} />
              </div>
            )}

            {legalNotice && (
              <div className="mb-4 rounded-lg border border-ui-border bg-ui-surface-muted p-4">
                <p className="mb-1 text-base font-medium text-ui-text">{t("legalNotice")}</p>
                <p className="whitespace-pre-wrap text-base text-ui-text">{legalNotice}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-base text-ui-text-muted">
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

          </>
        )}
      </Card>

      {canManage && !editMode && (
        <WorkflowPanel
          voting={voting}
          country={buildingData?.country ?? "sk"}
          onEdit={() => setEditMode(true)}
          onChanged={refetchVoting}
        />
      )}

      {/* BYT-20261118-002: owners get exactly one new element — the announcement PDF. */}
      {!canManage && voting.status !== "draft" && buildingData && documentsAvailable(buildingData, voting) && (
        <div className="mb-6">
          <NoticeDownloadLink voting={voting} building={buildingData} />
        </div>
      )}

      {/* BYT-20261118-001: owners' meeting — announcement, RSVP, attendance list. */}
      {voting.votingType === "meeting" && !editMode && voting.status !== "draft" ? (
        canManage || canRecordPaper ? (
          <MeetingBoardPanel
            voting={voting}
            building={buildingData}
            canAnnounce={canManage}
            castShare={
              data?.participation && data.participation.eligibleWeight > 0
                ? Math.round((data.participation.votedWeight / data.participation.eligibleWeight) * 1000) / 10
                : null
            }
          />
        ) : canVote ? (
          <MeetingOwnerCard votingId={id} />
        ) : null
      ) : null}

      {/* Meeting / owners_quarter info message */}
      {isActive && isMeetingOrOwnersQuarter && canVote && (
        <Card className="mb-6 border-ui-warning text-center">
          <p className="text-base text-ui-text">
            {voting.votingType === "meeting" ? t("meetingOnlyInfo") : t("ownersQuarterInfo")}
          </p>
        </Card>
      )}

      {/* Owner: one confirmed ballot per unit. */}
      {isActive && canVote && !isMeetingOrOwnersQuarter && userFlats.length > 0 && items.length > 0 && data && (
        <OwnerBallot
          voting={voting}
          items={items}
          userFlats={userFlats}
          userBallots={userBallots}
          hasPasskey={data.hasPasskey}
          hasPendingPasskey={Boolean(data.hasPendingPasskey)}
          onChanged={fetchVoteData}
        />
      )}

      <BoardConsole
        votingId={id}
        voting={voting}
        data={data}
        building={buildingData}
        legalNotice={legalNotice}
        sessionUserId={session?.user?.id ?? null}
        canRecordPaper={canRecordPaper}
        canMandate={canMandate}
        canManage={canManage}
        onRefresh={fetchVoteData}
      >
      {/* Per-item results */}
      {data && (isClosed || hasVotedAllFlats || canManage) && items.length > 0 && (
        <div className="mt-6 space-y-6">
          {items.map((item) => {
            const r = data.results.find((x) => x.itemId === item.id);
            if (!r) return null;
            const totalVotes = data.ballots.filter((b) =>
              b.choices.some((c) => c.itemId === item.id)
            ).length;
            return (
              <div key={item.id}>
                <div className="mb-2">
                  <h3 className="break-words text-lg font-bold text-ui-text">
                    {item.idx + 1}. {item.title}
                  </h3>
                  {item.description && (
                    <p className="whitespace-pre-wrap break-words text-base text-ui-text-muted">
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
                <ResultPresence results={r} />
              </div>
            );
          })}
        </div>
      )}

      </BoardConsole>

      {data && isClosed && items.length === 0 && (
        <Card className="text-base text-ui-text-muted">{t("noItems")}</Card>
      )}
    </div>
  );
}

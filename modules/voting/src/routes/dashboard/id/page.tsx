"use client";

// Voting detail. BYT-20261117-002 Phase 6 split the former single page into
// the shared header + results here, the owner cast flow (OwnerBallot) and
// the board / admin console (BoardConsole).
import { useSession } from "next-auth/react";
import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import VotingResults from "@/components/voting/VotingResults";
import { hasPermission } from "@/lib/permissions";
import ProjectDocsInline from "@/components/documents/ProjectDocsInline";
import { Badge, Button, Card, Icon, LoadingBlock } from "@/components/ui";
import type { UserRole, VotingStatus } from "@/types";
import OwnerBallot from "./OwnerBallot";
import BoardConsole, { EditVotingForm, ManageActions } from "./BoardConsole";
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
  const [buildingData, setBuildingData] = useState<BuildingInfo | null>(null);
  const [legalNotice, setLegalNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting404, setVoting404] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const role = (session?.user?.role || "owner") as UserRole;
  const canVote = hasPermission(role, "vote");
  const canRecordPaper = hasPermission(role, "recordPaperVote");
  const canMandate = hasPermission(role, "grantMandate");

  const fetchVoteData = useCallback(async () => {
    if (!hasPermission(role, "viewVotingResults")) return;
    const res = await fetch(`/api/ballots?votingId=${id}`);
    if (res.ok) setData(await res.json());
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

  async function handleStatusChange(status: VotingStatus) {
    await fetch(`/api/votings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const res = await fetch(`/api/votings/${id}`);
    if (res.ok) setVoting(await res.json());
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

            {canManage && (
              <ManageActions
                voting={voting}
                onEdit={() => setEditMode(true)}
                onStatusChange={handleStatusChange}
              />
            )}
          </>
        )}
      </Card>

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

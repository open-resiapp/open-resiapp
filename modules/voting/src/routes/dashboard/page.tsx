"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import VotingCard from "@/components/voting/VotingCard";
import { useShell } from "@/components/layout/ShellContext";
import { hasPermission } from "@/lib/permissions";
import { Button, ButtonLink, EmptyState, LoadingBlock, PageHeader } from "@/components/ui";
import type { UserRole, VotingStatus, VotingType } from "@/types";

interface VotingData {
  id: string;
  title: string;
  status: VotingStatus;
  votingType?: VotingType;
  entranceName?: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export default function HlasovaniePage({
  canCreate: canCreateProp,
}: {
  /** Server-resolved board check (admin OR active chairman). */
  canCreate?: boolean;
} = {}) {
  const { user, audience } = useShell();
  const t = useTranslations("Voting");
  const tl = useTranslations("VotingList");
  const tCommon = useTranslations("Common");
  const [votings, setVotings] = useState<VotingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const canCreate = canCreateProp ?? hasPermission(user.role as UserRole, "createVoting");
  const isBoard = audience === "board";

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch("/api/votings")
      .then((r) => {
        if (!r.ok) throw new Error("load");
        return r.json();
      })
      .then((data) => setVotings(Array.isArray(data) ? data : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The API already omits drafts for non-board viewers (canSeeDraftVotings);
  // this keeps owner-audience views draft-free regardless.
  const visible = isBoard ? votings : votings.filter((v) => v.status !== "draft");
  const groups: { key: string; title: string; items: VotingData[] }[] = [
    { key: "active", title: tl("groupActive"), items: visible.filter((v) => v.status === "active") },
    { key: "draft", title: tl("groupDraft"), items: visible.filter((v) => v.status === "draft") },
    { key: "closed", title: tl("groupClosed"), items: visible.filter((v) => v.status === "closed") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("title")}
        actions={canCreate && (loading || failed || visible.length > 0 || !isBoard) ? <ButtonLink href="/voting/new">{t("newVoting")}</ButtonLink> : undefined}
      />

      {loading ? (
        <LoadingBlock label={tCommon("loading")} />
      ) : failed ? (
        <EmptyState
          icon="alert"
          title={tl("loadFailedTitle")}
          description={tl("loadFailedText")}
          action={<Button onClick={load}>{tCommon("retry")}</Button>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="vote"
          title={isBoard ? tl("emptyBoardTitle") : tl("emptyOwnerTitle")}
          description={isBoard ? tl("emptyBoardText") : tl("emptyOwnerText")}
          action={
            isBoard && canCreate ? (
              <ButtonLink href="/voting/new">{tl("createFirst")}</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`grp-${g.key}`}>
              <h2 id={`grp-${g.key}`} className="mb-3 text-xl font-semibold text-ui-text">
                {g.title}
              </h2>
              <div className="space-y-4">
                {g.items.map((v) => (
                  <VotingCard
                    key={v.id}
                    id={v.id}
                    title={v.title}
                    status={v.status}
                    votingType={v.votingType}
                    entranceName={v.entranceName}
                    startsAt={v.startsAt}
                    endsAt={v.endsAt}
                    audience={audience}
                    createdByName={v.createdBy?.name}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

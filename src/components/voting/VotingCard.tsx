"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Badge, ButtonLink, Card, Icon } from "@/components/ui";
import type { VotingStatus, VotingType } from "@/types";

interface VotingCardProps {
  id: string;
  title: string;
  status: VotingStatus;
  votingType?: VotingType;
  entranceName?: string | null;
  startsAt: string;
  endsAt: string;
  /** Board sees authorship and drafts clearly marked; owners get a calmer card. */
  audience: "owner" | "board";
  createdByName?: string;
  /** The list API does not return whether the user already voted; only pass when known. */
  hasVoted?: boolean;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function VotingCard({
  id,
  title,
  status,
  votingType,
  entranceName,
  startsAt,
  endsAt,
  audience,
  createdByName,
  hasVoted,
}: VotingCardProps) {
  const t = useTranslations("VotingList");
  const tv = useTranslations("Voting");
  const format = useFormatter();

  const now = new Date();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateFmt = (d: Date) =>
    format.dateTime(d, { day: "numeric", month: "long", year: "numeric" });
  const days = Math.round((startOfDay(end) - startOfDay(now)) / 86_400_000);

  const notStarted = status === "active" && start > now;
  const expired = status === "active" && end < now;
  const open = status === "active" && !notStarted && !expired;

  let deadline: string | null = null;
  if (open) {
    deadline =
      days <= 0
        ? t("deadlineToday")
        : days === 1
          ? t("deadlineTomorrow")
          : t("deadlineDays", { days, date: dateFmt(end) });
  } else if (notStarted) {
    deadline = t("startsOn", { date: dateFmt(start) });
  } else if (expired) {
    deadline = t("deadlineExpired", { date: dateFmt(end) });
  } else if (status === "closed") {
    deadline = t("closedOn", { date: dateFmt(end) });
  } else {
    deadline = t("draftDates", { from: dateFmt(start), to: dateFmt(end) });
  }

  const typeLabel = votingType === "meeting" ? tv("typeMeeting") : votingType ? tv("typeWritten") : null;

  let action: React.ReactNode;
  if (audience === "owner") {
    if (open && hasVoted) {
      action = (
        <span className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-ui-success">
          <Icon name="check" size={20} />
          {t("voted")}
        </span>
      );
    } else if (open) {
      action = <ButtonLink href={`/voting/${id}`}>{t("vote")}</ButtonLink>;
    } else if (status === "closed") {
      action = (
        <ButtonLink href={`/voting/${id}`} variant="secondary">
          {t("showResults")}
        </ButtonLink>
      );
    } else {
      action = (
        <ButtonLink href={`/voting/${id}`} variant="secondary">
          {t("open")}
        </ButtonLink>
      );
    }
  } else {
    action = (
      <ButtonLink href={`/voting/${id}`} variant="secondary">
        {status === "closed" ? t("showResults") : t("open")}
      </ButtonLink>
    );
  }

  return (
    <Card as="article" padding="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && <Badge tone="warning">{t("draftBadge")}</Badge>}
        {status === "closed" && <Badge tone="neutral">{tv("statusClosed")}</Badge>}
        {open && <Badge tone="success">{tv("statusActive")}</Badge>}
        {typeLabel && <Badge tone="info">{typeLabel}</Badge>}
        {entranceName && <Badge tone="neutral">{entranceName}</Badge>}
      </div>

      <h3 className="break-words text-lg font-semibold text-ui-text">{title}</h3>

      <p className="text-base text-ui-text-muted">{deadline}</p>
      {audience === "board" && createdByName && (
        <p className="text-sm text-ui-text-muted">{tv("createdBy", { name: createdByName })}</p>
      )}

      {audience === "owner" && open && !hasVoted && hasVoted !== undefined && (
        <p className="text-base font-medium text-ui-text">{t("notVotedYet")}</p>
      )}

      <div className="mt-1">{action}</div>
    </Card>
  );
}

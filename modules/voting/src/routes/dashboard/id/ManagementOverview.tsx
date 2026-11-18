"use client";

// BYT-20261118-002 §5 — step "Priebeh" for the board / vote counter:
// per question → units (status chip + channel) → owners (share, choice,
// channel, time); "can it still pass" line; channel split bar. Data comes
// from the single GET /api/ballots response; "Obnoviť" is the only refetch
// (no timers, no polling). Stacked cards, no table → no h-scroll at 390 px.
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { BallotData, OverviewUnitLine } from "./types";

export type OverviewFilter = "all" | "notVoted" | "incomplete" | "paper" | "electronic";
type Filter = OverviewFilter;
const FILTERS: Filter[] = ["all", "notVoted", "incomplete", "paper", "electronic"];

function matches(u: OverviewUnitLine, f: Filter): boolean {
  switch (f) {
    case "notVoted":
      return u.channel === "none";
    case "incomplete":
      return u.status === "incomplete";
    case "paper":
      return u.channel === "paper" || u.channel === "mixed";
    case "electronic":
      return u.channel === "electronic" || u.channel === "mixed";
    default:
      return true;
  }
}

const STATUS_TONE: Record<OverviewUnitLine["status"], "success" | "danger" | "neutral" | "warning" | "info"> = {
  resolved_for: "success",
  resolved_against: "danger",
  resolved_abstain: "neutral",
  incomplete: "warning",
  no_valid_vote: "neutral",
};

export default function ManagementOverview({
  data,
  canRecordPaper,
  isActive,
  onRecordPaper,
  onRefresh,
  filter: controlledFilter,
  onFilterChange,
}: {
  data: BallotData;
  canRecordPaper: boolean;
  isActive: boolean;
  onRecordPaper: (preset: { ownerId: string; unitId: string }) => void;
  onRefresh: () => void;
  /** Controlled filter (BoardConsole's "not voted yet" line preselects notVoted). */
  filter?: Filter;
  onFilterChange?: (f: Filter) => void;
}) {
  const t = useTranslations("VotingWorkflow");
  const tVoting = useTranslations("Voting");
  const format = useFormatter();
  const [localFilter, setLocalFilter] = useState<Filter>("all");
  const filter = controlledFilter ?? localFilter;
  const setFilter = onFilterChange ?? setLocalFilter;
  const [openItem, setOpenItem] = useState<string | null>(data.items[0]?.id ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const ov = data.overview;
  if (!ov) return null;

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  return (
    <Card
      as="section"
      id="voting-overview"
      className="mb-6 scroll-mt-4 space-y-4"
      aria-labelledby="mgmt-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mgmt-heading" className="text-lg font-bold text-ui-text">
          {t("overview.heading")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base text-ui-text-muted">
            {t("overview.asOf", {
              time: format.dateTime(new Date(ov.generatedAt), { hour: "2-digit", minute: "2-digit" }),
            })}
          </span>
          <Button
            variant="secondary"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await onRefresh();
              setRefreshing(false);
            }}
          >
            {t("overview.refresh")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("overview.filterLabel")}>
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "primary" : "secondary"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`overview.filters.${f}`)}
          </Button>
        ))}
      </div>

      <ul className="space-y-4">
        {data.items.map((item) => {
          const units = ov.items.find((x) => x.itemId === item.id)?.units ?? [];
          const split = ov.channels.find((c) => c.itemId === item.id);
          const outlook = ov.outlook[item.id];
          const total = data.participation?.eligibleWeight ?? 0;
          const shown = units.filter((u) => matches(u, filter));
          const open = openItem === item.id;
          return (
            <li key={item.id} className="rounded-lg border border-ui-border p-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenItem(open ? null : item.id)}
                className="flex min-h-11 w-full items-start justify-between gap-2 text-left"
              >
                <span className="min-w-0 break-words text-base font-semibold text-ui-text">
                  {item.idx + 1}. {item.title}
                </span>
                {outlook && (
                  <Badge
                    tone={outlook === "passed" ? "success" : outlook === "reachable" ? "info" : "danger"}
                  >
                    {t(`overview.outlook.${outlook}`)}
                  </Badge>
                )}
              </button>

              {split && (
                <div className="mt-2 space-y-1">
                  <div
                    className="flex h-3 w-full overflow-hidden rounded-full bg-ui-surface-muted"
                    role="img"
                    aria-label={t("overview.channelSplit", {
                      electronic: pct(split.electronic, total),
                      paper: pct(split.paper, total),
                    })}
                  >
                    <div className="h-full bg-ui-primary" style={{ width: `${pct(split.electronic, total)}%` }} />
                    <div className="h-full bg-ui-warning" style={{ width: `${pct(split.paper, total)}%` }} />
                  </div>
                  <p className="text-base text-ui-text-muted">
                    {t("overview.channelSplit", {
                      electronic: pct(split.electronic, total),
                      paper: pct(split.paper, total),
                    })}
                  </p>
                </div>
              )}

              {open && (
                <ul className="mt-3 divide-y divide-ui-border">
                  {shown.length === 0 && (
                    <li className="py-2 text-base text-ui-text-muted">{t("overview.noneForFilter")}</li>
                  )}
                  {shown.map((u) => (
                    <li key={u.unitId} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-medium text-ui-text">
                          {tVoting("flatHeader", { number: u.unitLabel })}
                        </span>
                        <span className="flex flex-wrap gap-2">
                          <Badge tone={STATUS_TONE[u.status]}>{t(`overview.status.${u.status}`)}</Badge>
                          <Badge tone="neutral">{t(`overview.channel.${u.channel}`)}</Badge>
                        </span>
                      </div>
                      <ul className="mt-2 space-y-2">
                        {u.owners.map((o) => (
                          <li
                            key={o.ownerId}
                            className={cn(
                              "flex flex-col gap-2 rounded-md bg-ui-surface-muted p-2 text-base sm:flex-row sm:items-center sm:justify-between"
                            )}
                          >
                            <div className="min-w-0">
                              <p className="break-words text-ui-text">
                                {o.ownerName ?? tVoting("noOwnerName")}{" "}
                                <span className="text-ui-text-muted">
                                  ({o.shareNumerator}/{o.shareDenominator})
                                </span>
                              </p>
                              <p className="text-ui-text-muted">
                                {o.choice ? t(`overview.choice.${o.choice}`) : t("overview.choice.none")}
                                {o.channel ? ` · ${t(`overview.channel.${o.channel}`)}` : ""}
                                {o.recordedAt
                                  ? ` · ${format.dateTime(new Date(o.recordedAt), {
                                      day: "numeric",
                                      month: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}`
                                  : ""}
                              </p>
                            </div>
                            {canRecordPaper && isActive && (
                              <Button
                                variant="secondary"
                                onClick={() => onRecordPaper({ ownerId: o.ownerId, unitId: u.unitId })}
                              >
                                {tVoting("recordPaperFor")}
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

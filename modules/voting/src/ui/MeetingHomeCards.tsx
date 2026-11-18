// BYT-20261118-001 — owners' meeting blocks on Domov (server components).
//  - Board: "Schôdza 3. 12. — odpovedalo 18 z 42" row per upcoming meeting.
//  - Owner: the meeting card (three answers) under the running-vote card.
// Rendered from server data of the Domov request: no polling.
import { aliasedTable, and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

import { db } from "@/db";
import { entities, eventRsvps } from "@/db/schema";
import { LinkRow } from "@/components/home/LinkRow";
import type { Viewer } from "@/lib/home.server";
import { votings } from "../db/schema";
import { votingVisibilityFilter } from "../votings";
import { eligibleLines, getOwnMeetingState } from "../attendance";
import { MeetingOwnerCard, type OwnState } from "../routes/dashboard/id/MeetingPanel";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error("[voting] meeting home card failed:", err);
    return fallback;
  }
}

/** Announced meeting votings that have not started yet. */
function upcoming() {
  return and(
    eq(votings.votingType, "meeting"),
    eq(votings.status, "active"),
    isNotNull(votings.meetingPostId),
    gt(votings.startsAt, sql`now()`)
  );
}

async function loadBoardRows(viewer: Viewer) {
  // Shared voting visibility (scope / board) — not every board-audience
  // user (caretaker, council member) sees every entrance's meeting.
  const visible = votingVisibilityFilter(viewer);
  const rows = await db
    .select({
      id: votings.id,
      title: votings.title,
      startsAt: votings.startsAt,
      postId: votings.meetingPostId,
    })
    .from(votings)
    .where(visible ? and(upcoming(), visible) : upcoming())
    .orderBy(votings.startsAt)
    .limit(3);
  return Promise.all(
    rows.map(async (r) => {
      const [lines, [answered]] = await Promise.all([
        eligibleLines(r.id),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(eventRsvps)
          .where(eq(eventRsvps.postId, r.postId!)),
      ]);
      return {
        ...r,
        answered: answered?.n ?? 0,
        total: new Set(lines.map((l) => l.ownerId)).size,
      };
    })
  );
}

export async function MeetingBoardRows({ viewer }: { viewer: Viewer }) {
  const rows = await safe(loadBoardRows(viewer), []);
  if (rows.length === 0) return null;
  const t = await getTranslations("MeetingAttendance.home");
  const format = await getFormatter();
  return (
    <ul className="space-y-2" aria-label={t("boardLabel")}>
      {rows.map((r) => (
        <li key={r.id}>
          <LinkRow
            href={`/voting/${r.id}`}
            icon="users"
            label={
              <>
                <span className="block break-words">
                  {t("boardRow", {
                    date: format.dateTime(r.startsAt, { day: "numeric", month: "numeric" }),
                    answered: r.answered,
                    total: r.total,
                  })}
                </span>
                <span className="block font-normal text-ui-text-muted">{r.title}</span>
              </>
            }
          />
        </li>
      ))}
    </ul>
  );
}

async function loadOwnerMeetings(viewer: Viewer) {
  if (viewer.unitIds.length === 0) return [];
  const ve = aliasedTable(entities, "ve");
  const ue = aliasedTable(entities, "ue");
  const rows = await db
    .selectDistinct({ id: votings.id, title: votings.title, startsAt: votings.startsAt })
    .from(votings)
    .innerJoin(ve, eq(ve.id, votings.entityId))
    .innerJoin(ue, and(inArray(ue.id, viewer.unitIds), sql`${ue.path} LIKE ${ve.path} || '%'`))
    .where(upcoming())
    .orderBy(votings.startsAt)
    .limit(2);
  const states = await Promise.all(
    rows.map(async (r) => ({ ...r, state: await getOwnMeetingState(r.id, viewer.userId) }))
  );
  return states.filter((s) => s.state?.eligible);
}

export async function OwnerMeetingCards({ viewer }: { viewer: Viewer }) {
  if (!viewer.enabledModules.has("voting")) return null;
  const meetings = await safe(loadOwnerMeetings(viewer), []);
  if (meetings.length === 0) return null;
  return (
    <>
      {meetings.map((m) => (
        <MeetingOwnerCard
          key={m.id}
          votingId={m.id}
          title={m.title}
          initial={m.state as OwnState}
        />
      ))}
    </>
  );
}

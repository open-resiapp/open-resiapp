import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui";
import {
  listBoardContacts,
  listOpenVotingsForUnits,
  soft,
  type Viewer,
} from "@/lib/home.server";
import { listVisibleNotices } from "@/lib/notice-board.server";
import { hasPermission } from "@/lib/permissions";
import {
  getUnitBalanceLines,
  listOwnershipWindows,
  listUnitsWithSettlement,
  syncDuePostings,
  type UnitBalanceLine,
} from "@modules/accounting/src/lib/owner-payments";

import { BalanceCard } from "./BalanceCard";
import { BoardContacts } from "./BoardContacts";
import { HomeSection } from "./HomeSection";
import { LinkRow } from "./LinkRow";
import { NoticeList } from "./NoticeList";
import { VoteCards } from "./VoteCards";
import { OwnerFaultCardSlot } from "@modules/faults/src/components/OwnerFaultCard";
import { OwnerMeetingCards } from "@modules/voting/src/ui/MeetingHomeCards";

// Domov for owners (BYT-20261117-002 Phase 4), in this order: running
// vote → balance → deadlines → latest notices → board contacts. All data
// is loaded here in parallel; each block disappears when its module is
// off, there is no data, or its query fails.

interface OwnerAccounting {
  balances: UnitBalanceLine[];
  settlementReadyYear: number | null;
}

async function loadOwnerAccounting(viewer: Viewer): Promise<OwnerAccounting | null> {
  const root = viewer.root;
  if (!root) return null;
  // Units owned TODAY, with the viewer's ownership windows: the balance and
  // the settlement row cover only their own period (BYT-20261118-012).
  const units = (await listOwnershipWindows(viewer.userId, root.id)).filter((u) => u.current);
  if (units.length === 0) return null;
  // Same lazy posting the karta API runs before showing a balance. On a
  // lock timeout show the balance without the fresh postings.
  await soft(syncDuePostings(root.id, root.country), undefined);
  const lastYear = new Date().getUTCFullYear() - 1;
  const [balances, withSettlement] = await Promise.all([
    getUnitBalanceLines(root.id, root.country, units),
    listUnitsWithSettlement(root.id, units, lastYear),
  ]);
  return {
    balances,
    settlementReadyYear: withSettlement.length > 0 ? lastYear : null,
  };
}

export async function OwnerHome({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations("Home");
  const votingOn = viewer.enabledModules.has("voting");
  const accountingOn = viewer.enabledModules.has("accounting");

  const [votings, accounting, notices, contacts] = await Promise.all([
    votingOn && hasPermission(viewer.role, "vote")
      ? soft(listOpenVotingsForUnits(viewer.userId, viewer.unitIds), [])
      : Promise.resolve([]),
    accountingOn ? soft(loadOwnerAccounting(viewer), null) : Promise.resolve(null),
    hasPermission(viewer.role, "viewPosts")
      ? soft(listVisibleNotices({ userId: viewer.userId, isAdmin: viewer.isAdmin, limit: 3 }), [])
      : Promise.resolve([]),
    viewer.root ? soft(listBoardContacts(viewer.root.id), []) : Promise.resolve([]),
  ]);

  // One primary button per screen: the first vote still waiting, else
  // "Ako zaplatiť" when the owner owes.
  const firstOpen = votings.find((v) => !v.voted) ?? null;
  const balancePrimary =
    !firstOpen && !!accounting?.balances.some((b) => b.balanceCents > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title={t("greeting", { name: viewer.name })} className="mb-0" />

      {votings.length > 0 ? (
        <VoteCards votings={votings} primaryVotingId={firstOpen?.id ?? null} />
      ) : null}

      {/* BYT-20261118-001: upcoming owners' meeting — own answer (module-gated). */}
      <OwnerMeetingCards viewer={viewer} />

      {accounting ? <BalanceCard lines={accounting.balances} primary={balancePrimary} /> : null}

      {accounting?.settlementReadyYear ? (
        <HomeSection title={t("deadlines.heading")}>
          <ul className="space-y-2">
            <li>
              <LinkRow
                href="/moje-platby"
                icon="file"
                label={t("deadlines.settlementReady", { year: accounting.settlementReadyYear })}
              />
            </li>
          </ul>
        </HomeSection>
      ) : null}

      {hasPermission(viewer.role, "viewPosts") ? (
        <HomeSection
          title={t("notices.heading")}
          link={{ href: "/dom", label: t("notices.all") }}
        >
          <NoticeList notices={notices} />
        </HomeSection>
      ) : null}

      {/* BYT-20261118-004: "Niečo sa pokazilo?" (module-gated, self-loading). */}
      <OwnerFaultCardSlot viewer={viewer} />

      {contacts.length > 0 ? (
        <HomeSection title={t("contacts.heading")}>
          <BoardContacts contacts={contacts} />
        </HomeSection>
      ) : null}
    </div>
  );
}

import type { ComponentProps, ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { ButtonLink, Card, Icon, PageHeader, type IconName } from "@/components/ui";
import type { Link } from "@/i18n/navigation";
import {
  countPendingRegistrations,
  listRunningVotingsWithTurnout,
  soft,
  type Viewer,
} from "@/lib/home.server";
import { listVisibleNotices } from "@/lib/notice-board.server";
import { resolveBoardRootId } from "@/lib/current-entity";
import { countOwnerQueueWithoutRegistrations } from "@/lib/owner-health.server";
import { hasPermission } from "@/lib/permissions";
import { canReadAccounting } from "@modules/accounting/src/lib/authz";
import { getDashboardTiles, type DashboardTiles } from "@modules/accounting/src/lib/dashboard";
import { syncDuePostings } from "@modules/accounting/src/lib/owner-payments";
import { loadFaultTodoRows } from "@modules/faults/src/lib/home.server";

import { HomeSection } from "./HomeSection";
import { LinkRow, type LinkRowTone } from "./LinkRow";
import { NoticeList } from "./NoticeList";
import { VotingHomeCards } from "@modules/voting/src/ui/VotingHomeCards";
import { MeetingBoardRows } from "@modules/voting/src/ui/MeetingHomeCards";

// Domov for the board (BYT-20261117-002 Phase 4): "Čo treba teraz" — an
// ordered list of actionable rows, each shown only when its count > 0 —
// then the latest notices. Money rows use the accounting dashboard's own
// lib (getDashboardTiles, same numbers as the "Vyžaduje pozornosť" box)
// and only for users who may read accounting.

interface TodoRow {
  key: string;
  href: ComponentProps<typeof Link>["href"];
  icon: IconName;
  label: ReactNode;
  tone?: LinkRowTone;
}

async function loadMoneyTiles(viewer: Viewer): Promise<DashboardTiles | null> {
  const root = viewer.root;
  if (!root || !viewer.enabledModules.has("accounting")) return null;
  if (!(await canReadAccounting(viewer.userId, viewer.role, root.id))) return null;
  // Same as GET /api/accounting/dashboard: tiles reflect all due months.
  // A lock timeout must not hide the tiles — show them without fresh postings.
  await soft(syncDuePostings(root.id, root.country), undefined);
  return getDashboardTiles(root.id, root.country);
}

export async function BoardHome({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations("Home");
  const tHealth = await getTranslations("OwnerHealth");
  const canSeeNotices = hasPermission(viewer.role, "viewPosts");
  const canWriteAccounting = viewer.role === "admin" || viewer.boardRoles.includes("treasurer");

  const canManageUsers = hasPermission(viewer.role, "manageUsers");
  const [pending, ownerQueue, tiles, votings, notices] = await Promise.all([
    canManageUsers ? soft(countPendingRegistrations(), 0) : Promise.resolve(0),
    // BYT-20261118-003: same request-cached owners snapshot as the nav badge.
    canManageUsers
      ? soft(
          resolveBoardRootId(viewer.userId).then((rootId) =>
            countOwnerQueueWithoutRegistrations(rootId)
          ),
          0
        )
      : Promise.resolve(0),
    soft(loadMoneyTiles(viewer), null),
    viewer.enabledModules.has("voting")
      ? soft(listRunningVotingsWithTurnout(viewer), [])
      : Promise.resolve([]),
    canSeeNotices
      ? soft(listVisibleNotices({ userId: viewer.userId, isAdmin: viewer.isAdmin, limit: 3 }), [])
      : Promise.resolve([]),
  ]);

  const rows: TodoRow[] = [];
  if (pending > 0) {
    rows.push({
      key: "registrations",
      href: "/owners",
      icon: "users",
      label: t("todo.registrations", { count: pending }),
    });
  }
  if (ownerQueue > 0) {
    rows.push({
      key: "ownerQueue",
      href: "/owners#queue",
      icon: "users",
      label: tHealth("homeRow", { count: ownerQueue }),
    });
  }
  // BYT-20261118-004: new faults + faults open > 30 days (module-gated).
  rows.push(...(await soft(loadFaultTodoRows(viewer), [])));
  if (tiles) {
    const a = tiles.attention;
    if (a.vyuctovanieDeadline) {
      rows.push({
        key: "settlement",
        href: "/accounting/vyuctovanie",
        icon: "calendar",
        tone: a.vyuctovanieDeadline.sanctionActive ? "danger" : "warning",
        label: a.vyuctovanieDeadline.sanctionActive
          ? t("todo.settlementOverdue", { year: a.vyuctovanieDeadline.year })
          : t("todo.settlementDue", {
              year: a.vyuctovanieDeadline.year,
              days: a.vyuctovanieDeadline.daysUntil,
            }),
      });
    }
    // Matching bank lines is a write action (canWriteAccounting: admin or
    // treasurer) — same predicate on the request-cached viewer, no query.
    if (canWriteAccounting && a.unmatchedBankLines > 0) {
      rows.push({
        key: "unmatched",
        href: "/accounting/payments?tab=bank",
        icon: "wallet",
        label: t("todo.unmatchedPayments", { count: a.unmatchedBankLines }),
      });
    }
    if (a.overdueInvoices > 0) {
      rows.push({
        key: "invoices",
        href: "/accounting/expenses",
        icon: "file",
        tone: "warning",
        label: t("todo.overdueInvoices", { count: a.overdueInvoices }),
      });
    }
    if (a.revisionsOverdue > 0) {
      rows.push({
        key: "revisions",
        href: "/accounting/revisions",
        icon: "alert",
        tone: "danger",
        label: t("todo.overdueRevisions", { count: a.revisionsOverdue }),
      });
    }
  }
  for (const v of votings) {
    rows.push({
      key: `voting-${v.id}`,
      href: `/voting/${v.id}`,
      icon: "vote",
      label: (
        <>
          <span className="block break-words">{v.title}</span>
          <span className="block font-normal text-ui-text-muted">
            {t("todo.turnout", { voted: v.votedUnits, total: v.totalUnits })}
          </span>
        </>
      ),
    });
  }
  if (tiles && tiles.nedoplatky.count > 0) {
    rows.push({
      key: "arrears",
      href: "/accounting/karta",
      icon: "wallet",
      label: t("todo.arrears", { count: tiles.nedoplatky.count }),
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title={t("greeting", { name: viewer.name })} className="mb-0" />

      <HomeSection title={t("todo.heading")}>
        {rows.length === 0 ? (
          <Card padding="lg" className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ui-success/10 text-ui-success">
              <Icon name="check" size={22} />
            </span>
            <span>
              <span className="block text-lg font-semibold text-ui-text">{t("todo.nothing")}</span>
              <span className="block text-base text-ui-text-muted">{t("todo.nothingHint")}</span>
            </span>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key}>
                <LinkRow
                  href={r.href}
                  icon={r.icon}
                  tone={r.tone}
                  label={r.label}
                />
              </li>
            ))}
          </ul>
        )}
      </HomeSection>

      {/* BYT-20261118-002: result-publication reminders + e-vote readiness. */}
      {viewer.enabledModules.has("voting") ? <VotingHomeCards root={viewer.root} viewer={viewer} /> : null}
      {/* BYT-20261118-001: upcoming owners' meetings — answers so far. */}
      {viewer.enabledModules.has("voting") ? <MeetingBoardRows viewer={viewer} /> : null}

      {canSeeNotices ? (
        <HomeSection title={t("notices.heading")} link={{ href: "/board", label: t("notices.all") }}>
          <NoticeList notices={notices} />
          {hasPermission(viewer.role, "createPost") ? (
            <ButtonLink href="/board" variant="secondary">
              <Icon name="plus" size={20} />
              {t("notices.new")}
            </ButtonLink>
          ) : null}
        </HomeSection>
      ) : null}
    </div>
  );
}

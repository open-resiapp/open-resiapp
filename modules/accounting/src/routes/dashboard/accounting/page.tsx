"use client";

// Financie — Prehľad (BYT-20261117-002 Phase 5; was the 15-tile landing of
// BYT-20260512-002). Three numbers, then an ordered "Čo treba teraz"
// checklist built from the dashboard attention data, each row linking to
// the one place where it is solved. The cash projection is one sentence
// with the chart behind "Podrobnosti".
// Owners never land here — they are sent to /moje-platby.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  LoadingBlock,
  PageHeader,
  cn,
  type BadgeTone,
} from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import CashProjection, { type Projection } from "@modules/accounting/src/components/CashProjection";
import { useAccountingAccess } from "@modules/accounting/src/components/useAccountingAccess";

interface Tiles {
  attention: {
    unmatchedBankLines: number;
    uncategorizedExpenses: number;
    overdueInvoices: number;
    vyuctovanieDeadline: {
      year: number;
      deadline: string;
      daysUntil: number;
      sanctionActive: boolean;
    } | null;
    revisionsDueSoon: number;
    revisionsOverdue: number;
  };
  openingPosted: boolean;
  pokladnicaCents: number;
  bankaCents: number;
  fondOpravCents: number;
  nedoplatky: { count: number; totalCents: number };
}

interface TodoItem {
  key: string;
  text: string;
  count?: number;
  tone: BadgeTone;
  href: string;
  action: string;
}

export default function AccountingHomePage() {
  const { canRead } = useAccountingAccess();
  const router = useRouter();

  // Owners (no board read access) have their own screen.
  useEffect(() => {
    if (!canRead) router.replace("/moje-platby");
  }, [canRead, router]);

  if (!canRead) return <LoadingBlock />;
  return <BoardOverview />;
}

function BoardOverview() {
  const t = useTranslations("Accounting.home");
  // Matching bank lines needs write access (admin / treasurer); the
  // chairman only reads, so the row would lead to a dead end.
  const { canWrite } = useAccountingAccess();

  const [tiles, setTiles] = useState<Tiles | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Tiles) => setTiles(data))
      .catch(() => setError(true));
    fetch("/api/accounting/projection")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Projection | null) => {
        if (data) setProjection(data);
      })
      .catch(() => {});
  }, []);

  const header = <PageHeader title={t("title")} description={t("subtitle")} />;

  if (error) {
    return (
      <div className="max-w-4xl">
        {header}
        <p className="text-base text-ui-danger">{t("loadError")}</p>
      </div>
    );
  }
  if (!tiles) {
    return (
      <div className="max-w-4xl">
        {header}
        <LoadingBlock />
      </div>
    );
  }

  const a = tiles.attention;
  const todos: TodoItem[] = [];
  if (!tiles.openingPosted) {
    todos.push({
      key: "opening",
      text: t("todoOpening"),
      tone: "warning",
      href: "/accounting/onboarding/opening-balance",
      action: t("todoOpeningAction"),
    });
  }
  // A settlement already past its statutory deadline outranks everything.
  const settlement = a.vyuctovanieDeadline
    ? {
        key: "settlement",
        text: a.vyuctovanieDeadline.sanctionActive
          ? t("attentionVyuctovanieOverdue", { year: a.vyuctovanieDeadline.year })
          : t("attentionVyuctovanieDue", {
              year: a.vyuctovanieDeadline.year,
              days: a.vyuctovanieDeadline.daysUntil,
            }),
        tone: (a.vyuctovanieDeadline.sanctionActive ? "danger" : "warning") as BadgeTone,
        href: "/accounting/vyuctovanie",
        action: t("todoSettlementAction"),
      }
    : null;
  if (settlement && a.vyuctovanieDeadline?.sanctionActive) todos.push(settlement);
  if (canWrite && a.unmatchedBankLines > 0) {
    todos.push({
      key: "unmatched",
      text: t("todoUnmatched"),
      count: a.unmatchedBankLines,
      tone: "warning",
      href: "/accounting/payments?tab=bank",
      action: t("todoUnmatchedAction"),
    });
  }
  if (a.overdueInvoices > 0) {
    todos.push({
      key: "invoices",
      text: t("todoOverdueInvoices"),
      count: a.overdueInvoices,
      tone: "danger",
      href: "/accounting/expenses",
      action: t("todoInvoicesAction"),
    });
  }
  if (a.revisionsOverdue > 0) {
    todos.push({
      key: "revisionsOverdue",
      text: t("todoRevisionsOverdue"),
      count: a.revisionsOverdue,
      tone: "danger",
      href: "/accounting/revisions",
      action: t("todoRevisionsAction"),
    });
  }
  if (tiles.nedoplatky.count > 0) {
    todos.push({
      key: "arrears",
      text: t("todoArrears", { amount: formatEur(tiles.nedoplatky.totalCents) }),
      count: tiles.nedoplatky.count,
      tone: "warning",
      href: "/accounting/karta",
      action: t("todoArrearsAction"),
    });
  }
  if (settlement && !a.vyuctovanieDeadline?.sanctionActive) todos.push(settlement);
  if (a.revisionsDueSoon > 0) {
    todos.push({
      key: "revisionsSoon",
      text: t("todoRevisionsDueSoon"),
      count: a.revisionsDueSoon,
      tone: "info",
      href: "/accounting/revisions",
      action: t("todoRevisionsAction"),
    });
  }
  if (a.uncategorizedExpenses > 0) {
    todos.push({
      key: "uncategorized",
      text: t("todoUncategorized"),
      count: a.uncategorizedExpenses,
      tone: "neutral",
      href: "/accounting/expenses",
      action: t("todoInvoicesAction"),
    });
  }

  const moneyCents = tiles.bankaCents + tiles.pokladnicaCents;

  return (
    <div className="max-w-4xl space-y-8">
      {header}

      {/* Three numbers */}
      <section aria-label={t("numbersLabel")} className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-base text-ui-text-muted">{t("numberMoney")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ui-text">
            {formatEur(moneyCents)}
          </p>
          <p className="mt-1 text-base text-ui-text-muted">
            {t("numberMoneyDetail", {
              bank: formatEur(tiles.bankaCents),
              cash: formatEur(tiles.pokladnicaCents),
            })}
          </p>
        </Card>
        <Card>
          <p className="text-base text-ui-text-muted">{t("tileFondOprav")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ui-text">
            {formatEur(tiles.fondOpravCents)}
          </p>
          <p className="mt-1 text-base text-ui-text-muted">{t("numberFundDetail")}</p>
        </Card>
        <Card>
          <p className="text-base text-ui-text-muted">{t("numberOwed")}</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              tiles.nedoplatky.count > 0 ? "text-ui-danger" : "text-ui-text",
            )}
          >
            {formatEur(tiles.nedoplatky.totalCents)}
          </p>
          <p className="mt-1 text-base text-ui-text-muted">
            {t("nedoplatkyCount", { count: tiles.nedoplatky.count })}
          </p>
        </Card>
      </section>

      {/* Čo treba teraz */}
      <section aria-labelledby="todo-title">
        <h2 id="todo-title" className="mb-3 text-xl font-semibold text-ui-text">
          {t("todoTitle")}
        </h2>
        {todos.length === 0 ? (
          <Card>
            <EmptyState icon="check" title={t("todoEmptyTitle")} description={t("todoEmptyText")} />
          </Card>
        ) : (
          <ol className="space-y-3">
            {todos.map((item, i) => (
              <li key={item.key}>
                <Card padding="none">
                  <Link
                    href={item.href}
                    className="flex min-h-11 flex-col gap-3 rounded-xl p-4 hover:bg-ui-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ui-surface-muted text-base font-semibold text-ui-text"
                      >
                        {i + 1}
                      </span>
                      <span className="text-base text-ui-text">
                        {item.text}
                        {item.count !== undefined && (
                          <Badge tone={item.tone} className="ml-2 align-middle">
                            {item.count}
                          </Badge>
                        )}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 pl-10 text-base font-medium text-ui-primary sm:pl-0">
                      {item.action}
                      <Icon name="chevronRight" size={20} />
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {projection && projection.months.length > 0 && (
        <section aria-labelledby="projection-title">
          <h2 id="projection-title" className="mb-3 text-xl font-semibold text-ui-text">
            {t("projectionTitle")}
          </h2>
          <Card>
            <CashProjection projection={projection} />
          </Card>
        </section>
      )}
    </div>
  );
}

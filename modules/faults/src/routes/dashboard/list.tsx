import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ButtonLink, EmptyState, Icon, PageHeader } from "@/components/ui";
import { HomeSection } from "@/components/home/HomeSection";

import { isSeedCategorySlug } from "../../engine/catalog";
import {
  FILTER_COOKIE,
  hasAnyFilterParam,
  parseFilterCookie,
  parseFilters,
} from "../../engine/filters";
import { getFaultActor } from "../../lib/authz.server";
import {
  listCategories,
  listContractors,
  listFaultManagers,
  type CategoryOption,
} from "../../lib/catalogs.server";
import {
  countBoardFaults,
  listFaultsForBoard,
  listFaultsForResident,
} from "../../lib/queries.server";
import { BoardFaultList } from "../../components/BoardFaultList";
import { BoardFilters } from "../../components/BoardFilters";
import { NoticesFaultsTabs } from "../../components/NoticesFaultsTabs";
import { ResidentFaultList } from "../../components/ResidentFaultList";

// /poruchy — role-aware (BYT-20261118-004 IA). Board: "Oznamy · Poruchy"
// tabs + filtered task list. Residents: "Moje hlásenia" + "Hlásenia v dome".

type SearchParams = Record<string, string | string[] | undefined>;

export function categoryLabels(
  categories: CategoryOption[],
  t: (key: string) => string
): { value: string; label: string }[] {
  return categories.map((c) => ({
    value: c.id,
    label: c.customName ?? (isSeedCategorySlug(c.slug) ? t(`category.${c.slug}`) : c.slug),
  }));
}

export default async function FaultsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getFaultActor();
  if (!actor) notFound();
  const t = await getTranslations("Faults");
  const tx = t as unknown as (key: string) => string;

  if (actor.board) {
    // No params → restore the last filters from the cookie on THIS render.
    const filters = hasAnyFilterParam(searchParams)
      ? parseFilters(searchParams)
      : parseFilterCookie((await cookies()).get(FILTER_COOKIE)?.value);
    const [faults, categories, managers, contractors, counts] = await Promise.all([
      listFaultsForBoard(actor.root.id, filters),
      listCategories(actor.root.id),
      listFaultManagers(actor.root.id),
      listContractors(actor.root.id),
      countBoardFaults(actor.root.id),
    ]);
    const catOptions = categoryLabels(categories, tx);
    const catMap = Object.fromEntries(catOptions.map((c) => [c.value, c.label]));
    const assignees = [
      ...managers.map((m) => ({ value: m.id, label: m.name })),
      ...contractors.map((c) => ({ value: `c:${c.id}`, label: c.name })),
    ];

    return (
      <div className="mx-auto max-w-5xl">
        <NoticesFaultsTabs active="faults" newCount={counts.new} />
        <PageHeader
          title={t("board.title")}
          description={t("board.intro")}
          actions={
            actor.canReport ? (
              <ButtonLink href="/poruchy/nova" variant="secondary">
                <Icon name="plus" size={20} />
                {t("report.cta")}
              </ButtonLink>
            ) : undefined
          }
        />
        <BoardFilters filters={filters} categories={catOptions} assignees={assignees} />
        <p className="mb-3 text-base text-ui-text-muted" aria-live="polite">
          {t("list.count", { count: faults.length })}
        </p>
        {faults.length === 0 ? (
          <EmptyState icon="check" title={t("list.emptyBoard")} />
        ) : (
          <BoardFaultList faults={faults} categoryLabel={catMap} />
        )}
      </div>
    );
  }

  const [mine, others] = await Promise.all([
    listFaultsForResident(actor.userId, actor.root.id, "mine"),
    listFaultsForResident(actor.userId, actor.root.id, "others"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={t("resident.title")}
        description={t("resident.intro")}
        backHref="/dom"
        backLabel={t("resident.backToHouse")}
        actions={
          actor.canReport ? (
            <ButtonLink href="/poruchy/nova">
              <Icon name="plus" size={20} />
              {t("report.cta")}
            </ButtonLink>
          ) : undefined
        }
        className="mb-0"
      />
      <HomeSection title={t("resident.mine")}>
        {mine.length === 0 ? (
          <p className="text-base text-ui-text-muted">{t("resident.mineEmpty")}</p>
        ) : (
          <ResidentFaultList faults={mine} showLatestMessage />
        )}
      </HomeSection>
      <HomeSection title={t("resident.others")}>
        <p className="text-base text-ui-text-muted">{t("resident.othersHint")}</p>
        {others.length === 0 ? (
          <p className="text-base text-ui-text-muted">{t("resident.othersEmpty")}</p>
        ) : (
          <ResidentFaultList faults={others} showLatestMessage={false} />
        )}
      </HomeSection>
    </div>
  );
}

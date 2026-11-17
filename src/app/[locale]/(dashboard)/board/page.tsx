import { getTranslations } from "next-intl/server";

import FeedHeader from "@/components/nastenka/FeedHeader";
import FeedList, { type FeedViewerCaps } from "@/components/nastenka/FeedList";
import { ButtonLink, EmptyState, Icon, cn } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import {
  FEED_FILTERS,
  FILTER_CREATE_TYPE,
  parseFeedFilter,
  parseItemKey,
  parsePage,
  type FeedFilter,
} from "@/lib/feed";
import { loadFeed } from "@/lib/feed.server";
import { hasPermission } from "@/lib/permissions";
import { getShellData } from "@/lib/shell.server";

// "Oznamy" — one feed for board notices + community posts (events, help,
// sale/gift). BYT-20261117-002 Phase 5. Server-rendered; filters and paging
// are plain links (`?typ=`, `?strana=`) so they are shareable. Nothing live.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, sp, t] = await Promise.all([auth(), searchParams, getTranslations("Feed")]);
  if (!session?.user?.id) return null; // the layout already redirects to /login
  // Request-cached shell: skip the feed load while the layout shows
  // PendingShell / ConsentGate instead of this page.
  const shell = await getShellData(session);
  if (shell.user.status !== "active" || shell.consent.needsConsent) return null;

  const role = session.user.role;
  const filter = parseFeedFilter(sp.typ);
  const page = parsePage(sp.strana);
  const focus = parseItemKey(sp.prispevok);

  const canCreateNotice = hasPermission(role, "createPost");
  const canSeeCommunity = hasPermission(role, "viewCommunity");
  const canCreateCommunity = hasPermission(role, "createCommunityPost");
  const canCreate = canCreateNotice || canCreateCommunity;

  // A chip is shown when the viewer may create that type or it has content.
  const creatable: Record<Exclude<FeedFilter, "all">, boolean> = {
    oznamy: canCreateNotice,
    udalosti: canCreateCommunity,
    pomoc: canCreateCommunity,
    predaj: canCreateCommunity,
  };
  const visible: Record<Exclude<FeedFilter, "all">, boolean> = {
    oznamy: true,
    udalosti: canSeeCommunity,
    pomoc: canSeeCommunity,
    predaj: canSeeCommunity,
  };
  const countFilters = (Object.keys(creatable) as Exclude<FeedFilter, "all">[]).filter(
    (f) => visible[f] && !creatable[f]
  );

  const feed = await loadFeed({ id: session.user.id, role }, { filter, page, focus, countFilters });

  const chips = FEED_FILTERS.filter(
    (f) => f === "all" || f === filter || (visible[f] && (creatable[f] || feed.nonEmpty[f]))
  );

  const viewer: FeedViewerCaps = {
    userId: session.user.id,
    canManageNotices: canCreateNotice,
    canManageAllNotices:
      canCreateNotice && (role === "admin" || shell.user.boardRoles.length > 0),
    canModerate: hasPermission(role, "moderateCommunityResponse"),
    canRespond: hasPermission(role, "respondToCommunityPost"),
  };

  const filterCreate = FILTER_CREATE_TYPE[filter];
  const newHref =
    filterCreate && creatable[filter as Exclude<FeedFilter, "all">]
      ? { pathname: "/board/novy", query: { typ: filterCreate } }
      : "/board/novy";

  const hrefFor = (f: FeedFilter, p?: number) => ({
    pathname: "/board",
    query: {
      ...(f !== "all" ? { typ: f } : {}),
      ...(p && p > 1 ? { strana: String(p) } : {}),
    },
  });

  const empty = feed.items.length === 0 && !feed.focused;

  return (
    <div className="mx-auto max-w-3xl">
      <FeedHeader
        actions={
          canCreate ? (
            <ButtonLink href={newHref}>
              <Icon name="plus" size={20} />
              {t("new")}
            </ButtonLink>
          ) : undefined
        }
      />

      {chips.length > 1 ? (
        <nav aria-label={t("filtersLabel")} className="mb-5">
          <ul className="flex flex-wrap gap-2">
            {chips.map((f) => {
              const active = f === filter;
              return (
                <li key={f}>
                  <Link
                    href={hrefFor(f)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus",
                      active
                        ? "border-transparent bg-ui-primary text-ui-primary-text"
                        : "border-ui-border-strong bg-ui-surface text-ui-text hover:bg-ui-surface-muted"
                    )}
                  >
                    {t(`filter.${f}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {feed.focused ? (
        <section aria-label={t("linkedItem")} className="mb-6">
          <h2 className="mb-2 text-base font-medium text-ui-text-muted">{t("linkedItem")}</h2>
          <FeedList items={[feed.focused]} viewer={viewer} highlightKey={feed.focused.key} />
        </section>
      ) : null}

      {empty ? (
        <EmptyState
          icon="megaphone"
          title={filter === "all" ? t("empty.title") : t("empty.filteredTitle")}
          description={
            filter !== "all"
              ? undefined
              : canCreateNotice
                ? t("empty.boardText")
                : canCreateCommunity
                  ? t("empty.ownerText")
                  : t("empty.readOnlyText")
          }
          action={
            canCreate ? (
              <ButtonLink href={newHref} variant="secondary">
                <Icon name="plus" size={20} />
                {t("new")}
              </ButtonLink>
            ) : filter !== "all" ? (
              <ButtonLink href="/board" variant="secondary">
                {t("showAll")}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <FeedList items={feed.items} viewer={viewer} />
      )}

      {feed.hasMore ? (
        <div className="mt-6 flex justify-center">
          <ButtonLink href={hrefFor(filter, page + 1)} variant="secondary" scroll={false}>
            {t("loadOlder")}
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}

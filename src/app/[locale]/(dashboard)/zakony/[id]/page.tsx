import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { LawFootnotes, LawText } from "@/components/laws/LawText";
import { LawReaderControls } from "@/components/laws/LawReaderControls";
import { LawToc, chapterLabel } from "@/components/laws/LawToc";
import { ButtonLink, Card, Icon, PageHeader, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link, getPathname } from "@/i18n/navigation";
import { getViewer, isViewerGated } from "@/lib/home.server";
import { getChapters, searchLaw, type LawChapter } from "@/lib/laws-reader";
import { getLawFontSizeFromCookie } from "@/lib/laws-font.server";
import { getLaw } from "@/lib/laws.server";

// Law reader, e-book style: one chapter (časť / hlava …, see getChapters)
// per page via ?kapitola=n, TOC as sidebar (desktop) / sheet (phone),
// server-side search across all chapters via ?q=. Text is server-rendered;
// the only client JS is <LawReaderControls>.

const READER_ID = "law-reader";

export default async function LawReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, sp, viewer, t, format, fontSize] = await Promise.all([
    params,
    searchParams,
    getViewer(),
    getTranslations("Laws"),
    getFormatter(),
    getLawFontSizeFromCookie(),
  ]);
  if (!viewer || isViewerGated(viewer)) return null;

  const law = await getLaw(id);
  if (!law) notFound();

  const chapters = getChapters(law);
  const requested = Number.parseInt(typeof sp.kapitola === "string" ? sp.kapitola : "1", 10);
  const current = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), chapters.length) : 1;
  const chapter = chapters[current - 1];
  const query = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";

  const date = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const tocLabels = { wholeAct: t("wholeAct"), footnotes: t("footnotes"), tocLabel: t("toc") };
  const chapterHref = (n: number) => `/zakony/${law.id}?kapitola=${n}`;
  const sourceName = t(`sourceName_${law.jurisdiction}`);

  const toc = <LawToc lawId={law.id} chapters={chapters} current={chapter.index} labels={tocLabels} />;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={law.title}
        description={
          <>
            {law.number} ·{" "}
            {law.effectiveTo
              ? t("effectiveRange", { from: date(law.effectiveFrom), to: date(law.effectiveTo) })
              : t("effectiveFrom", { date: date(law.effectiveFrom) })}
          </>
        }
        backHref={`/zakony?j=${law.jurisdiction}`}
        backLabel={t("backToLaws")}
      />

      <Card as="aside" padding="sm" className="mb-6 flex gap-3 text-base">
        <Icon name="info" className="mt-0.5 shrink-0 text-ui-text-muted" />
        <div className="min-w-0 space-y-1">
          <p>{t(`disclaimer_${law.jurisdiction}`)}</p>
          {law.scope ? <p className="text-ui-text-muted">{t("scope", { scope: law.scope })}</p> : null}
          <p>
            <a
              href={law.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("underline underline-offset-2 break-words", focusRing)}
            >
              {t("openSource", { source: sourceName })}
              <span className="sr-only"> {t("opensInNewTab")}</span>
            </a>
          </p>
        </div>
      </Card>

      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8">
        {/* Desktop: sticky TOC sidebar. */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
            <h2 className="mb-2 px-2 text-base font-semibold text-ui-text">{t("toc")}</h2>
            {toc}
          </div>
        </aside>

        <div className="min-w-0">
          {/* Phone / tablet: TOC as a collapsible sheet. */}
          <details className="group mb-4 rounded-xl border border-ui-border bg-ui-surface lg:hidden">
            <summary
              className={cn(
                "flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-base font-semibold text-ui-text [&::-webkit-details-marker]:hidden",
                focusRing,
              )}
            >
              <span className="min-w-0 truncate">
                {t("toc")} · {t("chapterOf", { current: chapter.index, total: chapters.length })}
              </span>
              <Icon name="chevronDown" className="shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-h-[70vh] overflow-y-auto border-t border-ui-border p-2">{toc}</div>
          </details>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <form method="get" action={getPathname({ href: `/zakony/${law.id}`, locale })} role="search" className="flex w-full gap-2 sm:max-w-md">
              {/* Keep the chapter so "back to reading" returns to it. */}
              <input type="hidden" name="kapitola" value={chapter.index} />
              <label htmlFor="law-search" className="sr-only">
                {t("searchLabel")}
              </label>
              <input
                id="law-search"
                type="search"
                name="q"
                defaultValue={query}
                minLength={2}
                maxLength={100}
                placeholder={t("searchPlaceholder")}
                className={cn(
                  "min-h-11 w-full min-w-0 rounded-lg border border-ui-border-strong bg-ui-surface px-3 text-base text-ui-text placeholder:text-ui-text-muted",
                  focusRing,
                )}
              />
              <button
                type="submit"
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-ui-primary px-4 text-base font-medium text-ui-primary-text hover:opacity-90",
                  focusRing,
                )}
              >
                <Icon name="search" size={20} />
                <span>{t("searchSubmit")}</span>
              </button>
            </form>
            <LawReaderControls
              lawId={law.id}
              chapter={chapter.index}
              readerId={READER_ID}
              initialSize={fontSize}
              resolverBase={`${getPathname({ href: `/zakony/${law.id}/p`, locale })}/`}
              labels={{
                fontSize: t("fontSize"),
                sizes: { sm: t("fontSmall"), md: t("fontMedium"), lg: t("fontLarge") },
                copied: t("linkCopied", { label: "{label}" }),
                copyFailed: t("copyFailed"),
              }}
            />
          </div>

          {query ? (
            <SearchResults lawId={law.id} query={query} chapterIndex={chapter.index} t={t} result={searchLaw(law, query)} />
          ) : (
            <>
              <ChapterNav chapters={chapters} current={chapter.index} hrefFor={chapterHref} t={t} labels={tocLabels} />
              <div
                id={READER_ID}
                data-size={fontSize ?? "md"}
                className="mx-auto mt-6 max-w-[65ch] font-serif text-lg leading-relaxed text-ui-text [overflow-wrap:anywhere] data-[size=lg]:text-xl data-[size=sm]:text-base"
              >
                {chapter.trail.length ? (
                  <p className="mb-6 text-center font-sans text-base font-medium tracking-wide text-ui-text-muted">
                    {chapter.trail.join(" › ")}
                  </p>
                ) : null}
                {chapter.kind === "footnotes" ? (
                  <LawFootnotes footnotes={law.footnotes} title={t("footnotes")} />
                ) : (
                  <>
                    <LawText nodes={chapter.nodes} copyLabel={(label) => t("copyLink", { label })} />
                    {chapter.withFootnotes ? <LawFootnotes footnotes={law.footnotes} title={t("footnotes")} /> : null}
                  </>
                )}
              </div>
              <ChapterNav chapters={chapters} current={chapter.index} hrefFor={chapterHref} t={t} labels={tocLabels} bottom />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type T = (key: string, values?: Record<string, string | number>) => string;

function ChapterNav({
  chapters,
  current,
  hrefFor,
  t,
  labels,
  bottom = false,
}: {
  chapters: LawChapter[];
  current: number;
  hrefFor: (n: number) => string;
  t: T;
  labels: { wholeAct: string; footnotes: string };
  bottom?: boolean;
}) {
  if (chapters.length <= 1) return null;
  const prev = chapters[current - 2];
  const next = chapters[current];
  return (
    <nav
      aria-label={t("chapterNav")}
      className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", bottom && "mt-12 border-t border-ui-border pt-6")}
    >
      {prev ? (
        <ButtonLink href={hrefFor(prev.index)} variant="secondary" className="text-left">
          <Icon name="chevronLeft" size={20} className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-base text-ui-text-muted">{t("prevChapter")}</span>
            <span className="block break-words">{chapterLabel(prev, labels)}</span>
          </span>
        </ButtonLink>
      ) : (
        <span />
      )}
      <span className="order-first text-center text-base text-ui-text-muted sm:order-none">
        {t("chapterOf", { current, total: chapters.length })}
      </span>
      {next ? (
        <ButtonLink href={hrefFor(next.index)} variant="secondary" className="text-right">
          <span className="min-w-0">
            <span className="block text-base text-ui-text-muted">{t("nextChapter")}</span>
            <span className="block break-words">{chapterLabel(next, labels)}</span>
          </span>
          <Icon name="chevronRight" size={20} className="shrink-0" />
        </ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  );
}

function SearchResults({
  lawId,
  query,
  chapterIndex,
  result,
  t,
}: {
  lawId: string;
  query: string;
  chapterIndex: number;
  result: ReturnType<typeof searchLaw>;
  t: T;
}) {
  const back = (
    <Link href={`/zakony/${lawId}?kapitola=${chapterIndex}`} className={cn("inline-flex min-h-11 items-center gap-1 text-base underline underline-offset-2", focusRing)}>
      <Icon name="chevronLeft" size={20} />
      {t("searchBackToReading")}
    </Link>
  );

  if (query.length < 2) {
    return (
      <section aria-label={t("searchLabel")} className="space-y-3">
        <p className="text-base">{t("searchTooShort")}</p>
        {back}
      </section>
    );
  }

  return (
    <section aria-label={t("searchLabel")} className="space-y-4">
      <p role="status" className="text-base text-ui-text">
        {result.total ? t("searchResults", { count: result.total, query }) : t("searchNone", { query })}
        {result.total > result.hits.length ? ` ${t("searchShowing", { count: result.hits.length })}` : null}
      </p>
      {result.exact ? (
        <ButtonLink href={`/zakony/${lawId}?kapitola=${result.exact.chapter}#${result.exact.anchor}`}>
          {t("searchJump", { label: result.exact.label })}
        </ButtonLink>
      ) : null}
      <ol className="space-y-3">
        {result.hits.map((hit) => (
          <li key={hit.anchor}>
            <Link
              href={`/zakony/${lawId}?kapitola=${hit.chapter}#${hit.anchor}`}
              className={cn(
                "block rounded-xl border border-ui-border bg-ui-surface p-4 hover:border-ui-border-strong hover:bg-ui-surface-muted",
                focusRing,
              )}
            >
              <span className="block text-base font-semibold text-ui-text">
                {hit.label}
                {hit.heading ? <span className="font-normal text-ui-text-muted"> · {hit.heading}</span> : null}
              </span>
              <span className="mt-1 block font-serif text-base leading-relaxed text-ui-text [overflow-wrap:anywhere]">
                {hit.before}
                <mark className="rounded bg-ui-warning/25 px-0.5 text-ui-text">{hit.match}</mark>
                {hit.after}
              </span>
              <span className="mt-1 block text-base text-ui-text-muted">{t("inChapter", { n: hit.chapter })}</span>
            </Link>
          </li>
        ))}
      </ol>
      {back}
    </section>
  );
}

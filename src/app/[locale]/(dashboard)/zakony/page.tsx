import { getFormatter, getTranslations } from "next-intl/server";

import { ContinueReading } from "@/components/laws/ContinueReading";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";
import { getViewer, isViewerGated } from "@/lib/home.server";
import { LAW_JURISDICTIONS, isLawJurisdiction, type LawJurisdiction } from "@/lib/laws";
import { listLaws } from "@/lib/laws.server";

// Laws library — every active member can read it (reference material, no
// personal data). The list defaults to the community's country; explicit
// tabs switch jurisdiction (?j=sk|cz).

export default async function LawsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, viewer, t, format] = await Promise.all([
    searchParams,
    getViewer(),
    getTranslations("Laws"),
    getFormatter(),
  ]);
  if (!viewer || isViewerGated(viewer)) return null;

  const fallback: LawJurisdiction = viewer.root?.country === "cz" ? "cz" : "sk";
  const jurisdiction = isLawJurisdiction(sp.j) ? sp.j : fallback;

  const all = await listLaws();
  const laws = all.filter((l) => l.jurisdiction === jurisdiction);
  const date = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("intro")} className="mb-0" />

      <ContinueReading
        laws={all.map((l) => ({ id: l.id, title: l.title, number: l.number }))}
        labels={{ button: t("continueReading"), hint: t("continueReadingHint", { title: "{title}" }) }}
      />

      <Tabs
        aria-label={t("jurisdictionsLabel")}
        value={jurisdiction}
        items={LAW_JURISDICTIONS.map((j) => ({
          value: j,
          label: t(`jurisdiction_${j}`),
          href: `/zakony?j=${j}`,
          badge: all.filter((l) => l.jurisdiction === j).length,
        }))}
      />

      {laws.length === 0 ? (
        <EmptyState icon="file" title={t("empty")} />
      ) : (
        <ul className="space-y-3">
          {laws.map((law) => (
            <li key={law.id}>
              <Card padding="none" className="overflow-hidden">
                <Link
                  href={`/zakony/${law.id}`}
                  className={`flex items-start gap-3 p-4 hover:bg-ui-surface-muted sm:p-5 ${focusRing}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium text-ui-text-muted">{law.number}</span>
                    <span className="mt-0.5 block text-lg font-semibold text-ui-text break-words">{law.title}</span>
                    <span className="mt-1 block text-base text-ui-text-muted">
                      {law.effectiveTo
                        ? t("effectiveRange", { from: date(law.effectiveFrom), to: date(law.effectiveTo) })
                        : t("effectiveFrom", { date: date(law.effectiveFrom) })}
                      {law.scope ? ` · ${t("scope", { scope: law.scope })}` : null}
                    </span>
                  </span>
                  <Icon name="chevronRight" className="mt-1 shrink-0 text-ui-text-muted" />
                </Link>
                <div className="border-t border-ui-border px-4 py-2 sm:px-5">
                  <a
                    href={law.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex min-h-11 items-center gap-1 rounded text-base text-ui-text-muted underline underline-offset-2 hover:text-ui-text ${focusRing}`}
                  >
                    {t("openSource", { source: t(`sourceName_${law.jurisdiction}`) })}
                    <span className="sr-only"> {t("opensInNewTab")}</span>
                  </a>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-base text-ui-text-muted">{t("languageNote")}</p>
    </div>
  );
}

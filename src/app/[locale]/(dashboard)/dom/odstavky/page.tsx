import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState, Icon, PageHeader } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { getViewer, isViewerGated } from "@/lib/home.server";
import {
  UTILITY_TYPES,
  groupByUtility,
  listProviders,
  resolveProviderCountry,
  telHref,
} from "@/lib/utility-providers";

// Utility outages directory (BYT-20261118-008): static link-out list per
// country, grouped by utility. No fetch, no DB beyond the viewer's root.
// TODO(decision): board pin of the building's heat supplier (entities.data
// utilityPins) not shipped — /api/building PATCH has no generic data path and
// a settings form is out of this slice. Heat group is empty until then.

const BTN =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-4 py-2 text-base font-medium text-ui-text transition-colors hover:border-ui-border-strong hover:bg-ui-surface-muted";

export default async function OutagesPage() {
  const [viewer, t, format] = await Promise.all([
    getViewer(),
    getTranslations("Outages"),
    getFormatter(),
  ]);
  if (!viewer || isViewerGated(viewer)) return null;

  const country = resolveProviderCountry(viewer.root?.country);
  const providers = listProviders(country);
  const groups = groupByUtility(providers);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title={t("title")} description={t("intro")} className="mb-0" />

      {providers.length === 0 ? <EmptyState icon="alert" title={t("empty")} /> : null}

      {providers.length > 0
        ? UTILITY_TYPES.map((u) => (
            <section key={u} className="space-y-3">
              <h2 className="text-lg font-semibold text-ui-text">{t(`utility_${u}`)}</h2>
              {groups[u].length === 0 ? (
                <p className="text-base text-ui-text-muted">{t(`noneFor_${u}`)}</p>
              ) : (
                <ul className="space-y-3">
                  {groups[u].map((p) => (
                    <li
                      key={p.id}
                      className="space-y-3 rounded-xl border border-ui-border bg-ui-surface p-4"
                    >
                      <p className="text-base font-semibold text-ui-text">{p.name}</p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={p.outageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${BTN} ${focusRing}`}
                        >
                          <Icon name="link" size={20} />
                          {t("outagesLink")}
                        </a>
                        {p.hotline ? (
                          <a href={telHref(p.hotline)} className={`${BTN} ${focusRing}`}>
                            <Icon name="phone" size={20} />
                            {t("callHotline", { number: p.hotline })}
                          </a>
                        ) : null}
                      </div>
                      <p className="text-base text-ui-text-muted">
                        {t("verifiedOn", {
                          date: format.dateTime(new Date(`${p.verifiedAt}T00:00:00Z`), {
                            dateStyle: "medium",
                            timeZone: "UTC",
                          }),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        : null}

      <p className="text-base text-ui-text-muted">{t("disclaimer")}</p>
    </div>
  );
}

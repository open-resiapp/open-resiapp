import { getTranslations } from "next-intl/server";

import { ButtonLink, Card, Icon } from "@/components/ui";
import { HomeSection } from "@/components/home/HomeSection";
import { LinkRow } from "@/components/home/LinkRow";
import type { Viewer } from "@/lib/home.server";

import { loadOwnerFaultCard } from "../lib/home.server";

// Owner Domov secondary card "Niečo sa pokazilo?" (BYT-20261118-004 IA):
// one secondary button "Nahlásiť poruchu" + a link to own open reports.

export async function OwnerFaultCard({
  data,
}: {
  data: { canReport: boolean; openNew: number; openInProgress: number };
}) {
  const t = await getTranslations("Faults");
  const open = data.openNew + data.openInProgress;
  return (
    <HomeSection title={t("home.ownerHeading")}>
      <Card padding="md" className="space-y-3">
        <p className="text-base text-ui-text">{t("home.ownerText")}</p>
        {data.canReport ? (
          <ButtonLink href="/poruchy/nova" variant="secondary">
            <Icon name="alert" size={20} />
            {t("report.cta")}
          </ButtonLink>
        ) : null}
      </Card>
      {open > 0 ? (
        <LinkRow
          href="/poruchy"
          icon="file"
          label={t("home.ownerOpen", { inProgress: data.openInProgress, waiting: data.openNew })}
        />
      ) : null}
    </HomeSection>
  );
}

/** Self-loading slot for OwnerHome: renders nothing when the module is off. */
export async function OwnerFaultCardSlot({ viewer }: { viewer: Viewer }) {
  const data = await loadOwnerFaultCard(viewer).catch(() => null);
  return data ? <OwnerFaultCard data={data} /> : null;
}

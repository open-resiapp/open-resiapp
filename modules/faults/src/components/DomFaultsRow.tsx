import { getTranslations } from "next-intl/server";

import { LinkRow } from "@/components/home/LinkRow";
import type { Viewer } from "@/lib/home.server";

// Dom → "Poruchy" row (BYT-20261118-004 IA). Renders an <li>; nothing when
// the faults module is disabled.

export async function DomFaultsRow({ viewer }: { viewer: Viewer }) {
  if (!viewer.enabledModules.has("faults")) return null;
  const t = await getTranslations("Faults");
  return (
    <li>
      <LinkRow href="/poruchy" icon="alert" label={t("dom.label")} hint={t("dom.hint")} />
    </li>
  );
}

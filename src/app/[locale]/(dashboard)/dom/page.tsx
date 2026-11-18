import { getTranslations } from "next-intl/server";

import { BoardContacts } from "@/components/home/BoardContacts";
import { HomeSection } from "@/components/home/HomeSection";
import { LinkRow } from "@/components/home/LinkRow";
import { PageHeader } from "@/components/ui";
import { getViewer, isViewerGated, listBoardContacts, soft } from "@/lib/home.server";
import { hasPermission } from "@/lib/permissions";

// Dom (BYT-20261117-002 Phase 4) — the owner's "about the building" hub:
// notices (the unified /board feed), documents, board contacts inline,
// neighbours directory and "Ako hospodári dom" (right to inspect, §11
// ods. 6). Server component; each row only when the user may open it.

export default async function HousePage() {
  const [viewer, t] = await Promise.all([getViewer(), getTranslations("Dom")]);
  if (!viewer || isViewerGated(viewer)) return null;

  const contacts = viewer.root ? await soft(listBoardContacts(viewer.root.id), []) : [];
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(viewer.role, p);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={viewer.root?.name ?? t("title")}
        description={viewer.root?.address || t("intro")}
        className="mb-0"
      />

      <ul className="space-y-2">
        {can("viewPosts") ? (
          <li>
            <LinkRow href="/board" icon="megaphone" label={t("notices")} hint={t("noticesHint")} />
          </li>
        ) : null}
        {can("viewDocuments") ? (
          <li>
            <LinkRow href="/documents" icon="file" label={t("documents")} hint={t("documentsHint")} />
          </li>
        ) : null}
        <li>
          <LinkRow href="/zakony" icon="file" label={t("laws")} hint={t("lawsHint")} />
        </li>
      </ul>

      <HomeSection title={t("contacts")}>
        <BoardContacts contacts={contacts} />
      </HomeSection>

      <ul className="space-y-2">
        {/* Directory: shown to everyone who may view it — owners/tenants can
            always opt in themselves, so an empty directory still has a use. */}
        {can("viewDirectory") || can("editOwnDirectory") ? (
          <li>
            <LinkRow
              href="/komunita/adresar"
              icon="users"
              label={t("neighbours")}
              hint={t("neighboursHint")}
            />
          </li>
        ) : null}
        {viewer.enabledModules.has("accounting") ? (
          <li>
            <LinkRow
              href="/accounting/inspect"
              icon="wallet"
              label={t("finances")}
              hint={t("financesHint")}
            />
          </li>
        ) : null}
      </ul>
    </div>
  );
}

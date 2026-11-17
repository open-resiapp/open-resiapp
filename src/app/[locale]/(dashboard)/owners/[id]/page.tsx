import { getTranslations } from "next-intl/server";

import { ButtonLink, EmptyState } from "@/components/ui";
import OwnerDetail from "@/components/owners/OwnerDetail";
import { auth } from "@/lib/auth";
import { loadOwnerDetail } from "@/lib/owners-board.server";
import { hasPermission } from "@/lib/permissions";
import { getShellData } from "@/lib/shell.server";
import type { UserRole } from "@/types";

// Owner detail — server-loaded (BYT-20261117-002 Phase 5). Interaction lives in
// <OwnerDetail>; mutations go through the existing /api/users/[id],
// /api/admin/shell-users/* endpoints and refresh this page.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OwnerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const t = await getTranslations("Owners");
  const tCommon = await getTranslations("Common");

  const role = (session?.user?.role ?? "owner") as UserRole;
  if (!hasPermission(role, "manageUsers")) {
    return <EmptyState icon="users" title={t("noPermission")} />;
  }

  // Request-cached: the layout already resolved the shell. Skip the load
  // while the layout shows PendingShell / ConsentGate instead of this page.
  const shell = session ? await getShellData(session) : null;
  if (!shell || shell.user.status !== "active" || shell.consent.needsConsent) return null;
  const rootId = shell.entities.currentId;
  const data = UUID_RE.test(id) ? await loadOwnerDetail(id, rootId) : null;
  if (!data) {
    return (
      <EmptyState
        icon="user"
        title={t("userNotFound")}
        action={
          <ButtonLink variant="secondary" href="/owners">
            {tCommon("backToList")}
          </ButtonLink>
        }
      />
    );
  }

  return <OwnerDetail data={data} />;
}

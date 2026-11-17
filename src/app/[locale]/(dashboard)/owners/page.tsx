import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui";
import OwnersBoard, { type OwnersFilter } from "@/components/owners/OwnersBoard";
import { auth } from "@/lib/auth";
import { OWNER_STATUSES, type OwnerStatus } from "@/lib/owners-board";
import { loadOwnersBoard } from "@/lib/owners-board.server";
import { hasPermission } from "@/lib/permissions";
import { getShellData } from "@/lib/shell.server";
import type { UserRole } from "@/types";

// BYT-20261117-002 Phase 5 — Vlastníci: one page for every way a person gets
// into the system (owner records, invitations, self-registrations). Loaded
// once on the server; the client part only handles interaction and calls
// router.refresh() after a mutation.

export default async function OwnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [{ locale }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const t = await getTranslations("Owners.board");

  // Same gate the old client page and every owners API route use.
  const role = (session?.user?.role ?? "owner") as UserRole;
  if (!hasPermission(role, "manageUsers")) {
    return <EmptyState icon="users" title={t("noPermission")} />;
  }

  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const initialFilter: OwnersFilter = OWNER_STATUSES.includes(raw as OwnerStatus)
    ? (raw as OwnerStatus)
    : "all";

  // Request-cached: the layout already resolved the shell. Skip the load
  // while the layout shows PendingShell / ConsentGate instead of this page.
  const shell = session ? await getShellData(session) : null;
  if (!shell || shell.user.status !== "active" || shell.consent.needsConsent) return null;
  const rootId = shell.entities.currentId;
  const data = await loadOwnersBoard(rootId);
  return <OwnersBoard data={data} initialFilter={initialFilter} locale={locale} />;
}

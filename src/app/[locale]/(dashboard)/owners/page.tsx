import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui";
import OwnersBoard, { type OwnersFilter } from "@/components/owners/OwnersBoard";
import { auth } from "@/lib/auth";
import type { CheckFilter } from "@/components/owners/OwnersHealth";
import { CHECK_CODES, type CheckCode } from "@/lib/owner-checks";
import { loadOwnerHealth } from "@/lib/owner-health.server";
import { OWNER_STATUSES, type OwnerStatus } from "@/lib/owners-board";
import { loadOwnersBoard } from "@/lib/owners-board.server";
import { hasPermission } from "@/lib/permissions";
import { getRequestCommunityRoot, getShellData } from "@/lib/shell.server";
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
  searchParams: Promise<{
    status?: string | string[];
    check?: string | string[];
    unit?: string | string[];
  }>;
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
    : raw === "former"
      ? "former"
      : "all";
  // BYT-20261118-003: server-readable filters of the data checks / unit.
  const rawCheck = Array.isArray(sp.check) ? sp.check[0] : sp.check;
  const initialCheck: CheckFilter = CHECK_CODES.includes(rawCheck as CheckCode)
    ? (rawCheck as CheckCode)
    : "all";
  const rawUnit = Array.isArray(sp.unit) ? sp.unit[0] : sp.unit;
  const initialUnit = rawUnit && /^[0-9a-f-]{36}$/i.test(rawUnit) ? rawUnit : null;

  // Request-cached: the layout already resolved the shell. Skip the load
  // while the layout shows PendingShell / ConsentGate instead of this page.
  const shell = session ? await getShellData(session) : null;
  if (!shell || shell.user.status !== "active" || shell.consent.needsConsent) return null;
  // An admin without a unit has no membership root; fall back to the
  // community root the rest of the shell (home, accounting) uses.
  const rootId =
    shell.entities.currentId ?? (await getRequestCommunityRoot())?.id ?? null;
  // Both read the request-cached owners snapshot the shell already loaded
  // for the nav badge — no second round of owners queries.
  const [data, health] = await Promise.all([loadOwnersBoard(rootId), loadOwnerHealth(rootId)]);
  return (
    <OwnersBoard
      data={data}
      health={health}
      initialFilter={initialFilter}
      initialCheck={initialCheck}
      initialUnit={initialUnit}
      locale={locale}
    />
  );
}

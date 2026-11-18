import { getTranslations } from "next-intl/server";

import { ButtonLink, EmptyState } from "@/components/ui";
import OwnerDetail from "@/components/owners/OwnerDetail";
import { auth } from "@/lib/auth";
import { loadOwnerDetail, loadOwnersSnapshot } from "@/lib/owners-board.server";
import { findRestorableRemoval, loadOwnershipHistory } from "@/lib/ownership.server";
import { rankCandidates } from "@/lib/name-match";
import { hasPermission } from "@/lib/permissions";
import { getRequestCommunityRoot, getShellData } from "@/lib/shell.server";
import type { UserRole } from "@/types";

// Owner detail — server-loaded (BYT-20261117-002 Phase 5). Interaction lives in
// <OwnerDetail>; mutations go through the existing /api/users/[id],
// /api/admin/shell-users/* endpoints and refresh this page.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OwnerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, auth()]);
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
  // An admin without a unit has no membership root; fall back to the
  // community root the rest of the shell (home, accounting) uses.
  const rootId =
    shell.entities.currentId ?? (await getRequestCommunityRoot())?.id ?? null;
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

  // BYT-20261118-007: ownership timeline + lifecycle actions. The people
  // list comes from the request-cached owners snapshot (no extra queries).
  const [history, restorable, snapshot, root] = await Promise.all([
    loadOwnershipHistory(id, rootId!),
    findRestorableRemoval(id, rootId!),
    loadOwnersSnapshot(rootId!),
    getRequestCommunityRoot(),
  ]);
  const others = snapshot.board.people.filter((p) => p.id !== id);
  const suggested = new Set(
    rankCandidates(data.owner.name, others.map((p) => ({ id: p.id, name: p.name })), 0.5).map((r) => r.candidate.id)
  );
  const sameContact = (p: (typeof others)[number]) =>
    (!!data.owner.email && p.email?.toLowerCase() === data.owner.email.toLowerCase()) ||
    (!!data.owner.phone && p.phone === data.owner.phone);
  const lifecycle = {
    history,
    restorable,
    country: (root?.country === "cz" ? "cz" : "sk") as "sk" | "cz",
    people: snapshot.board.people
      .filter((p) => !p.formerUntil)
      .map((p) => ({ id: p.id, name: p.name })),
    mergeOptions: others.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      flatLabel: p.flats.map((f) => f.flatNumber).join(", ") || null,
      suggested: suggested.has(p.id) || sameContact(p),
    })),
  };

  // `?edit=1` — opened from the "Na riešenie" queue (missing e-mail).
  return <OwnerDetail data={data} initialEditing={sp.edit === "1"} lifecycle={lifecycle} />;
}

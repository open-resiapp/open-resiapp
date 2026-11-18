import "server-only";
import { isUnitHolderRole } from "@/lib/role-options";

import { cache } from "react";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, ownerQueueDismissals } from "@/db/schema";
import { runOwnershipChecks, type CheckMembership } from "@/lib/owner-checks";
import {
  EMPTY_OWNER_HEALTH,
  type CheckEntry,
  type DismissErrorCode,
  type OwnerHealthData,
  type QueueEntry,
} from "@/lib/owner-health";
import { computeOwnerQueue, countBadgeItems, type QueuePerson } from "@/lib/owner-queue";
import { loadOwnersSnapshot } from "@/lib/owners-board.server";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { isUnitTypeSet } from "@/lib/unit-type";

// BYT-20261118-003 — "Na riešenie" queue + ownership checks for one
// community root. Derived at read time from the rows the Vlastníci page
// already loads (loadOwnersSnapshot, request-cached) plus two small indexed
// reads (root meta, dismissals). No writes on read, no polling, no
// cross-request state. Writes happen only in dismiss / undo (board action).

/**
 * BSM / LV-ordinal checks only for SK / CZ HOA communities; the unit-type
 * check (unit_type_unset) for every HOA community.
 */
async function rootCheckFlags(rootId: string): Promise<{ lvChecks: boolean; hoa: boolean }> {
  const [row] = await db
    .select({
      templateSlug: sql<string | null>`${entities.data}->>'template_slug'`,
      country: sql<string | null>`${entities.data}->>'country'`,
    })
    .from(entities)
    .where(eq(entities.id, rootId))
    .limit(1);
  if (!row) return { lvChecks: false, hoa: false };
  // Pre-template installs carry no slug — they are HOA installs.
  const slug = row.templateSlug ? getDisplayTemplateSlug(row.templateSlug) : "hoa";
  const country = (row.country ?? "sk").toLowerCase();
  const hoa = slug === "hoa";
  return { lvChecks: hoa && (country === "sk" || country === "cz"), hoa };
}

function listDismissals(rootId: string) {
  return db
    .select({
      id: ownerQueueDismissals.id,
      fingerprint: ownerQueueDismissals.fingerprint,
      handledAt: ownerQueueDismissals.handledAt,
    })
    .from(ownerQueueDismissals)
    .where(eq(ownerQueueDismissals.rootId, rootId));
}

async function compute(rootId: string, now: Date): Promise<OwnerHealthData> {
  const { raw, board } = await loadOwnersSnapshot(rootId);
  const [{ lvChecks, hoa }, dismissalRows] = await Promise.all([
    rootCheckFlags(rootId),
    listDismissals(rootId),
  ]);
  const dismissalByFp = new Map(
    dismissalRows.map((d) => [d.fingerprint, { id: d.id, handledAt: d.handledAt.toISOString() }])
  );

  // ── Queue ───────────────────────────────────────────────────────────
  const lastLoginById = new Map(raw.userRows.map((u) => [u.id, u.lastLoginAt]));
  const personById = new Map(board.people.map((p) => [p.id, p]));
  const people: QueuePerson[] = board.people.map((p) => ({
    id: p.id,
    status: p.status,
    deactivated: p.deactivated,
    email: p.email,
    flatCount: p.flats.length,
    createdAt: p.createdAt,
    invite: p.invite,
    lastLoginAt: lastLoginById.get(p.id)?.toISOString() ?? null,
  }));
  const queueAll: QueueEntry[] = computeOwnerQueue(people, now).map((item) => {
    const p = personById.get(item.userId);
    return {
      ...item,
      name: p?.name ?? "",
      email: p?.email ?? null,
      flatNumbers: p?.flats.map((f) => f.flatNumber) ?? [],
      dismissal: dismissalByFp.get(item.fingerprint) ?? null,
    };
  });

  // ── Ownership checks ────────────────────────────────────────────────
  const units = raw.unitRows.map((u) => ({ id: u.id, unitTypeSet: isUnitTypeSet(u.unitType) }));
  const unitLabel = new Map(raw.unitRows.map((u) => [u.id, u.flatNumber ?? ""]));
  const nameById = new Map(raw.userRows.map((u) => [u.id, u.name]));
  const ownerMemberships: CheckMembership[] = raw.membershipRows
    .filter((m) => isUnitHolderRole(m.role))
    .map((m) => ({
      userId: m.userId,
      unitId: m.unitId,
      shareNum: m.shareNum,
      shareDen: m.shareDen,
      lvOrdinal: m.lvOrdinal,
      ownershipForm: m.ownershipForm,
    }));
  const checksAll: CheckEntry[] = runOwnershipChecks(units, ownerMemberships, {
    lvChecks,
    unitTypeCheck: hoa,
  }).map(
    (f) => ({
      ...f,
      unitLabels: f.unitIds.map((id) => unitLabel.get(id) ?? ""),
      names: f.userIds.map((id) => nameById.get(id) ?? ""),
      dismissal: dismissalByFp.get(f.fingerprint) ?? null,
    })
  );

  const queue = queueAll.filter((i) => !i.dismissal);
  return {
    queue,
    queueDismissed: queueAll.filter((i) => i.dismissal),
    checks: checksAll.filter((c) => !c.dismissal),
    checksDismissed: checksAll.filter((c) => c.dismissal),
    badgeCount: countBadgeItems(queue),
    lvChecks,
  };
}

/** Once per request (shell badge, Domov row and /owners share it). */
export const loadOwnerHealth = cache(async function loadOwnerHealth(
  rootId: string | null
): Promise<OwnerHealthData> {
  if (!rootId) return EMPTY_OWNER_HEALTH;
  return compute(rootId, new Date());
});

/** Nav badge: open queue items (informative codes and data checks excluded). */
export async function countOwnerQueue(rootId: string | null): Promise<number> {
  return (await loadOwnerHealth(rootId)).badgeCount;
}

/** Domov row: badge items other than registrations (those have their own row). */
export async function countOwnerQueueWithoutRegistrations(rootId: string | null): Promise<number> {
  const h = await loadOwnerHealth(rootId);
  return h.badgeCount - h.queue.filter((i) => i.code === "registration_pending").length;
}

// ── Writes (board action only) ────────────────────────────────────────

/**
 * Mark the item / finding with `fingerprint` as handled for the whole board
 * of `rootId`. Only fingerprints that exist right now can be dismissed.
 * Same transaction prunes dismissals of this root whose condition is gone
 * (never on page load). Idempotent: a second dismiss returns the same row.
 */
export async function dismissOwnerHealthItem(
  rootId: string,
  actorUserId: string,
  fingerprint: string
): Promise<{ ok: true; id: string } | { ok: false; error: DismissErrorCode }> {
  const health = await compute(rootId, new Date());
  const queueItem = [...health.queue, ...health.queueDismissed].find(
    (i) => i.fingerprint === fingerprint
  );
  const check = [...health.checks, ...health.checksDismissed].find(
    (c) => c.fingerprint === fingerprint
  );
  if (!queueItem && !check) return { ok: false, error: "not_found" };

  const live = [
    ...health.queue,
    ...health.queueDismissed,
    ...health.checks,
    ...health.checksDismissed,
  ].map((x) => x.fingerprint);

  try {
    const id = await db.transaction(async (tx) => {
      await tx
        .delete(ownerQueueDismissals)
        .where(
          and(
            eq(ownerQueueDismissals.rootId, rootId),
            notInArray(ownerQueueDismissals.fingerprint, live)
          )
        );
      const [inserted] = await tx
        .insert(ownerQueueDismissals)
        .values({
          rootId,
          code: queueItem ? queueItem.code : check!.code,
          subjectUserId: queueItem ? queueItem.userId : null,
          subjectUnitId: check && check.unitIds.length === 1 ? check.unitIds[0] : null,
          fingerprint,
          handledById: actorUserId,
        })
        .onConflictDoNothing({
          target: [ownerQueueDismissals.rootId, ownerQueueDismissals.fingerprint],
        })
        .returning({ id: ownerQueueDismissals.id });
      if (inserted) return inserted.id;
      const [existing] = await tx
        .select({ id: ownerQueueDismissals.id })
        .from(ownerQueueDismissals)
        .where(
          and(
            eq(ownerQueueDismissals.rootId, rootId),
            eq(ownerQueueDismissals.fingerprint, fingerprint)
          )
        )
        .limit(1);
      return existing?.id ?? null;
    });
    return id ? { ok: true, id } : { ok: false, error: "failed" };
  } catch (err) {
    console.error("[owner-health] dismiss failed", err);
    return { ok: false, error: "failed" };
  }
}

/** Undo "vyriešené": delete the dismissal row (scoped to the root). */
export async function undoOwnerHealthDismissal(
  rootId: string,
  dismissalId: string
): Promise<{ ok: true } | { ok: false; error: DismissErrorCode }> {
  try {
    const rows = await db
      .delete(ownerQueueDismissals)
      .where(
        and(eq(ownerQueueDismissals.id, dismissalId), eq(ownerQueueDismissals.rootId, rootId))
      )
      .returning({ id: ownerQueueDismissals.id });
    return rows.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
  } catch (err) {
    console.error("[owner-health] undo failed", err);
    return { ok: false, error: "failed" };
  }
}

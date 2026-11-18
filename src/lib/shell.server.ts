import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { getBranding } from "@/lib/branding.server";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";
import { getConsentStatus } from "@/lib/consent.server";
import { resolveCurrentEntityContext } from "@/lib/current-entity";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { listEnabledModules } from "@/lib/modules/route-guard";
import { getNavAudience } from "@/lib/navigation";
import { getOnboardingStatus } from "@/lib/onboarding.server";
import { countOwnerQueue } from "@/lib/owner-health.server";
import { hasPermission } from "@/lib/permissions";
import { listShareSumViolations } from "@/lib/share-sum-invariants.server";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { getTemplate } from "@/lib/templates/loader";
import { listActiveBoardRoles as listActiveBoardRolesUncached } from "@/lib/user-context";
import {
  EMPTY_KIND_CHAIN,
  type CommunityKindChain,
  type ShellData,
} from "@/lib/shell";
import type { BoardMemberRole } from "@/types";

// BYT-20261117-002 Phase 1: everything the dashboard chrome needs, resolved
// ONCE per request on the server and passed to <ShellProvider>. Replaces
// the 8 client fetches the shell used to fire on mount. Read-only queries,
// no caching across requests (multi-replica safe). The existing API routes
// share the same helpers and stay for other callers.
//
// Request scope: everything below is wrapped in React `cache()`, which in
// the App Router lives for ONE server request only (no cross-request or
// cross-replica state). The layout and the page of the same request — and
// `getViewer` in src/lib/home.server.ts — therefore share one resolution of
// each slice instead of repeating the queries.
//
// Connection budget: the pg pool (src/db/index.ts) uses the driver default
// of 10 connections per replica. The slices run in small sequential groups
// so one shell resolution never holds more than ~4 connections at once.

/** Swallow a failure of an optional shell slice instead of 500-ing the layout. */
async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error("[shell] slice failed", err);
    return fallback;
  }
}

/** Community root, once per request. */
export const getRequestCommunityRoot = cache(() => getCommunityRoot());

/**
 * Consent slice, once per request — shared by the layout (which swaps in
 * <ConsentGate>) and getViewer (pages skip their data loads meanwhile).
 * Pending users never saw the consent gate; keep it that way. On a failed
 * lookup let the user through (previous ConsentGate behaviour).
 */
export const getRequestConsent = cache(async function getRequestConsent(
  userId: string,
  isActive: boolean
): Promise<{ needsConsent: boolean; policyVersion: string }> {
  if (!isActive) return { needsConsent: false, policyVersion: CURRENT_POLICY_VERSION };
  return soft(
    getConsentStatus(userId).then((c) => ({
      needsConsent: c.needsConsent,
      policyVersion: c.currentPolicyVersion,
    })),
    { needsConsent: false, policyVersion: CURRENT_POLICY_VERSION }
  );
});

/**
 * Enabled module names, once per request — from the route guard's
 * per-replica 60 s cache (the same source isModuleEnabled uses), so the
 * shell and the module guards agree and core_modules is not re-queried.
 */
export const getRequestEnabledModules = cache(() => listEnabledModules());

/** Active board roles of `userId` on the root entity, once per request (user-context.ts). */
export const listActiveBoardRoles = cache(
  (userId: string, entityId: string): Promise<BoardMemberRole[]> =>
    listActiveBoardRolesUncached(userId, entityId)
);

/** Live units with an active membership of `userId`, once per request. */
export const listOwnUnitIds = cache(async function listOwnUnitIds(
  userId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: memberships.entityId })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );
  return rows.map((r) => r.id);
});

// Same population as GET /api/registrations/pending (self-registrants
// waiting for approval; shell users excluded). One indexed count, once per
// request (the board home shows the same number).
export const countPendingRegistrations = cache(async function countPendingRegistrations(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.status, "pending"), isNotNull(users.passwordHash)));
  return row?.count ?? 0;
});

// Same derivation the old useCommunityKinds hook did client-side from
// /api/templates?slug=… (templates are static JSON shipped with the build).
async function resolveKindChain(templateSlug: string | null): Promise<CommunityKindChain> {
  if (!templateSlug) return EMPTY_KIND_CHAIN;
  const tpl = await getTemplate(templateSlug);
  if (!tpl) return EMPTY_KIND_CHAIN;
  const levels: string[] = Array.isArray(tpl.import_levels) ? tpl.import_levels : [];
  return {
    templateSlug,
    rootKind: levels[0] ?? tpl.root_kind ?? null,
    // The "middle" label maps to the row above the leaf.
    middleKind: levels.length >= 3 ? levels[levels.length - 2] : null,
    leafKind: levels.length > 0 ? levels[levels.length - 1] : null,
  };
}

export function getShellData(session: Session): Promise<ShellData> {
  const { id, name, email, role, status } = session.user;
  // Keyed by primitives so callers holding different session objects of the
  // same request still hit the cache.
  return resolveShellData(id, name ?? "", email ?? "", role, status);
}

const resolveShellData = cache(async function resolveShellData(
  userId: string,
  name: string,
  email: string,
  role: Session["user"]["role"],
  status: Session["user"]["status"]
): Promise<ShellData> {
  const isActive = status === "active";
  const isSettingsAdmin = hasPermission(role, "manageSettings");
  const isUsersAdmin = hasPermission(role, "manageUsers");

  const root = await soft(getRequestCommunityRoot(), null);

  // Group 1 — at most 4 connections.
  const [branding, enabledModules, entityCtx, consent] = await Promise.all([
    soft(getBranding(), null),
    soft(getRequestEnabledModules(), [] as string[]),
    soft(resolveCurrentEntityContext(userId), { options: [], currentId: null }),
    getRequestConsent(userId, isActive),
  ]);

  // Group 2 — 2 connections (the kind chain reads bundled template JSON).
  const [boardRoles, unitIds, kinds] = await Promise.all([
    root ? soft(listActiveBoardRoles(userId, root.id), [] as BoardMemberRole[]) : [],
    soft(listOwnUnitIds(userId), [] as string[]),
    soft(resolveKindChain(root?.templateSlug ?? null), EMPTY_KIND_CHAIN),
  ]);

  // Groups 3 + 4 are independent → one Promise.all.
  // Group 3 — admins only; onboarding runs 3 counts + 1 share-sum scan.
  // Group 4 — manageUsers only (BYT-20261118-003). The owners snapshot of
  // the board's current community (same root rule as /owners) runs once
  // (4 queries + root meta + dismissals) and feeds both the "Na riešenie"
  // nav badge and the scoped share-sum banner; /owners and Domov reuse it.
  const ownersRootId = entityCtx.currentId ?? root?.id ?? null;
  const [onboarding, ownerQueue, shareSumViolations] = await Promise.all([
    isActive && isSettingsAdmin
      ? soft(
          getOnboardingStatus(root).then((s) => ({ complete: s.complete })),
          null
        )
      : Promise.resolve(null),
    isActive && isUsersAdmin ? soft(countOwnerQueue(ownersRootId), 0) : Promise.resolve(0),
    isActive && isUsersAdmin
      ? soft(listShareSumViolations(ownersRootId), [] as Awaited<ReturnType<typeof listShareSumViolations>>)
      : Promise.resolve([] as Awaited<ReturnType<typeof listShareSumViolations>>),
  ]);

  return {
    user: {
      id: userId,
      name,
      email,
      role,
      status,
      boardRoles,
      unitIds,
    },
    audience: getNavAudience({ role, boardRoles }),
    community: root
      ? {
          id: root.id,
          name: root.name,
          templateSlug: root.templateSlug,
          displayTemplateSlug: getDisplayTemplateSlug(root.templateSlug),
          kinds,
          country: root.country ?? null,
          address: root.address ?? null,
          ico: root.ico ?? null,
          dic: root.dic ?? null,
          legalNotice: root.legalNotice ?? null,
        }
      : null,
    branding: {
      logoUrl: branding?.branding.v
        ? `/api/branding/asset/logo?v=${encodeURIComponent(branding.branding.v)}`
        : null,
    },
    enabledModules,
    entities: entityCtx,
    consent,
    onboarding,
    shareSumViolations,
    badges: ownerQueue > 0 ? { ownerQueue } : {},
  };
});

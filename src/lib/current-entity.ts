import "server-only";
import { cookies } from "next/headers";

import { listUserRoots } from "@/lib/entity-tree";
import { getCommunityRoot } from "@/lib/legacy-compat";

const COOKIE_NAME = "current-entity-id";
// 30 days — entity context is sticky across sessions.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function getCurrentEntityIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  return value && value.length > 0 ? value : null;
}

export async function setCurrentEntityIdCookie(entityId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, entityId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearCurrentEntityIdCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Resolve the entity the user is currently scoped to. Falls back to
 * the user's first accessible root when no cookie is set or the cookie
 * points at an entity the user no longer holds membership in.
 */
export async function resolveCurrentEntityId(
  userId: string
): Promise<string | null> {
  const fromCookie = await getCurrentEntityIdFromCookie();
  const roots = await listUserRoots(userId);
  if (roots.length === 0) return null;
  if (fromCookie && roots.some((r) => r.id === fromCookie)) return fromCookie;
  return roots[0].id;
}

/**
 * Options + resolved current id with a single roots query. Used by the
 * dashboard server layout (ShellData) instead of calling
 * `listCurrentEntityOptions` + `resolveCurrentEntityId` back to back.
 */
export async function resolveCurrentEntityContext(userId: string): Promise<{
  options: { id: string; name: string; kind: string }[];
  currentId: string | null;
}> {
  const [fromCookie, roots] = await Promise.all([
    getCurrentEntityIdFromCookie(),
    listUserRoots(userId),
  ]);
  const options = roots.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
  if (roots.length === 0) return { options, currentId: null };
  const currentId =
    fromCookie && roots.some((r) => r.id === fromCookie) ? fromCookie : roots[0].id;
  return { options, currentId };
}

/** Used by the header switcher to render the dropdown options. */
export async function listCurrentEntityOptions(userId: string) {
  const roots = await listUserRoots(userId);
  return roots.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
}

/**
 * Board-side scope: the user's current root, or — for an admin who holds no
 * unit and therefore no membership — the community root the rest of the
 * shell uses (getCommunityRoot). Callers must already have checked the
 * permission; this only picks the community.
 */
export async function resolveBoardRootId(userId: string): Promise<string | null> {
  const fromMembership = await resolveCurrentEntityId(userId);
  if (fromMembership) return fromMembership;
  return (await getCommunityRoot())?.id ?? null;
}

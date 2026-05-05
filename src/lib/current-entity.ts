import "server-only";
import { cookies } from "next/headers";

import { listUserRoots } from "@/lib/entity-tree";

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

/** Used by the header switcher to render the dropdown options. */
export async function listCurrentEntityOptions(userId: string) {
  const roots = await listUserRoots(userId);
  return roots.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
}

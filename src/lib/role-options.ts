// Client-safe, pure. BYT-20261118-020 — which global roles an admin can
// assign in the owners / invitation dialogs of a given community.
//
// The unit holder is `owner` in an SVB (zák. 182/1993) and `member` (člen
// družstva, §221 ods. 1 Obch. zák. 513/1991 / §727 ZOK) in a bytové
// družstvo. Server code reads the template's `member_role`
// (src/lib/import/seed.ts resolveHolderRole); client code has no template
// JSON, so it derives the same answer from the legal regime — keep the two
// in sync (bytove_druzstvo.json member_role:"member" ⇔ regime cooperative).

import { legalRegimeFor } from "@/lib/legal-copy/regime";
import type { UserRole } from "@/types";

export type UnitHolderRole = "owner" | "member";

/** Roles that hold a unit (owner share, voting weight). */
export const UNIT_HOLDER_ROLES: UnitHolderRole[] = ["owner", "member"];

export function isUnitHolderRole(role: string): role is UnitHolderRole {
  return role === "owner" || role === "member";
}

/** Every global role the server accepts when assigning one to a person. */
export const ASSIGNABLE_ROLES: UserRole[] = [
  "owner",
  "member",
  "tenant",
  "vote_counter",
  "caretaker",
  "accountant",
  "spravca",
  "admin",
];

export function unitHolderRoleFor(templateSlug: string | null | undefined): UnitHolderRole {
  return legalRegimeFor(templateSlug) === "cooperative" ? "member" : "owner";
}

/**
 * Role options for a community: the template's unit holder role (owner OR
 * member, never both), then staff roles. `admin` only when `includeAdmin`.
 * `current` is appended when it falls outside the list (a legacy `owner`
 * in a družstvo stays visible and selectable in the edit form).
 */
export function roleOptionsFor(
  templateSlug: string | null | undefined,
  opts: { includeAdmin?: boolean; current?: UserRole } = {}
): UserRole[] {
  const holder = unitHolderRoleFor(templateSlug);
  const list: UserRole[] = [holder, "tenant", "vote_counter", "caretaker", "accountant", "spravca"];
  if (opts.includeAdmin) list.push("admin");
  if (opts.current && !list.includes(opts.current)) list.push(opts.current);
  return list;
}

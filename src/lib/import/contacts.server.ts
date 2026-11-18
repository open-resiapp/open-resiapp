import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { UNIT_HOLDER_ROLES } from "@/lib/role-options";

import { db } from "@/db";
import { entityAuditLog, memberships, users } from "@/db/schema";

import { importUnitLabel, normaliseOwnerName } from "./owner-groups";
import { importUnitKey, matchExistingUnits } from "./seed";
import type { ImportRow } from "./types";

// "Update e-mails / phones only" import mode: creates nothing. Every row is
// matched to an EXISTING owner by unit + normalised name; the row's e-mail /
// phone is written onto that owner.
//
// E-mail is the login identity: it is only FILLED on an owner who has none
// (shell owner from an earlier LV import). A different existing e-mail is
// never overwritten — reported as `email_differs` for the admin to resolve on
// the owner card. An e-mail that already belongs to another account is
// reported as `email_taken`. Phone is updated whenever it differs.

export type ContactIssue =
  | "unit_not_found"
  | "owner_not_found"
  | "email_taken"
  | "email_differs"
  | "nothing_to_update";

export interface ContactChange {
  row: number;
  userId: string;
  name: string;
  unit: string;
  email?: string;
  phone?: string;
}

export interface ContactPlan {
  changes: ContactChange[];
  issues: { row: number; unit: string; name: string; code: ContactIssue }[];
}

export async function planContactUpdates(input: {
  rows: ImportRow[];
  communityId: string;
  templateSlug?: string;
}): Promise<ContactPlan> {
  const matches = await matchExistingUnits({
    rows: input.rows,
    communityId: input.communityId,
    templateSlug: input.templateSlug,
  });
  const unitIds = [...new Set([...matches.values()].map((m) => m.unitId))];
  const owners = unitIds.length
    ? await db
        .select({
          unitId: memberships.entityId,
          userId: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(memberships.entityId, unitIds),
            inArray(memberships.role, UNIT_HOLDER_ROLES),
            eq(memberships.status, "active"),
            isNull(memberships.validTo)
          )
        )
    : [];

  const wantedEmails = [
    ...new Set(
      input.rows.map((r) => r.owner_email?.trim().toLowerCase()).filter((e): e is string => !!e)
    ),
  ];
  const emailOwners = wantedEmails.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(sql<string>`lower(${users.email})`, wantedEmails))
    : [];
  const emailOwnerId = new Map(emailOwners.map((u) => [(u.email ?? "").toLowerCase(), u.id]));

  const plan: ContactPlan = { changes: [], issues: [] };
  const byUser = new Map<string, ContactChange>();
  input.rows.forEach((r, idx) => {
    const row = idx + 1;
    const unit = importUnitLabel(r);
    const match = matches.get(importUnitKey(r));
    if (!match) {
      plan.issues.push({ row, unit, name: r.owner_name, code: "unit_not_found" });
      return;
    }
    const wanted = normaliseOwnerName(r.owner_name);
    const owner = owners.find(
      (o) => o.unitId === match.unitId && normaliseOwnerName(o.name) === wanted
    );
    if (!owner) {
      plan.issues.push({ row, unit, name: r.owner_name, code: "owner_not_found" });
      return;
    }
    const change: ContactChange = byUser.get(owner.userId) ?? {
      row,
      userId: owner.userId,
      name: owner.name,
      unit,
    };
    const email = r.owner_email?.trim().toLowerCase();
    if (email && email !== (owner.email ?? "").toLowerCase()) {
      const holder = emailOwnerId.get(email);
      if (holder && holder !== owner.userId) {
        plan.issues.push({ row, unit, name: r.owner_name, code: "email_taken" });
      } else if (owner.email) {
        plan.issues.push({ row, unit, name: r.owner_name, code: "email_differs" });
      } else {
        change.email = email;
      }
    }
    const phone = r.owner_phone?.trim();
    if (phone && phone !== (owner.phone ?? "")) change.phone = phone.slice(0, 30);
    if (change.email || change.phone) {
      byUser.set(owner.userId, change);
    } else if (!byUser.has(owner.userId) && !email && !phone) {
      plan.issues.push({ row, unit, name: r.owner_name, code: "nothing_to_update" });
    }
  });
  plan.changes = [...byUser.values()];
  return plan;
}

export async function applyContactUpdates(input: {
  rows: ImportRow[];
  communityId: string;
  templateSlug?: string;
  actorUserId: string;
}): Promise<ContactPlan> {
  const plan = await planContactUpdates(input);
  if (plan.changes.length === 0) return plan;
  await db.transaction(async (tx) => {
    for (const c of plan.changes) {
      const patch: { email?: string; phone?: string } = {};
      if (c.email) patch.email = c.email;
      if (c.phone) patch.phone = c.phone;
      await tx
        .update(users)
        .set(patch)
        .where(
          c.email
            ? and(eq(users.id, c.userId), isNull(users.email)) // never overwrite a login e-mail
            : eq(users.id, c.userId)
        );
      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "user.update_contact",
        entityId: null,
        afterJson: JSON.stringify({
          userId: c.userId,
          emailSet: !!c.email,
          phoneSet: !!c.phone,
          source: "import",
        }),
      });
    }
  });
  return plan;
}

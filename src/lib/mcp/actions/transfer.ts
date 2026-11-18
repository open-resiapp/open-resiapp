import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { memberships } from "@/db/schema";
import { TRANSFER_KINDS, type ImpactPlan, type LifecycleErrorCode } from "@/lib/ownership";
import { planTransfer, transferOwnership, type TransferInput } from "@/lib/ownership.server";
import { isUserInRoot } from "@/lib/owners-board.server";
import { hasPermission } from "@/lib/permissions";
import { isReadonly } from "@/lib/readonly";
import { getUserAuthRow } from "@/lib/user-context";
import { McpError, validationError } from "../errors";
import { uuidSchema } from "../tools/helpers";
import { fmtDate, translatorFor } from "./format";
import { defineAction, type ActionContext, type PreviewRow } from "./types";

// Owner sale / inheritance / gift (BYT-20261118-007 lifecycle, via MCP).
// Mirrors the Vlastníci "Zmena vlastníka" dialog exactly:
//   - same authz: manageUsers on the community root (lifecycle-actions.ts
//     boardCtx) and the same "visible in this root" check for every person;
//   - same plan: planTransfer (validation + impact plan with its hash);
//   - same write: transferOwnership(input, actor, planHash) — ONE
//     transaction that re-plans under a row lock and refuses with
//     plan_stale when anything changed since the preview.
// The plan hash is part of the normalised payload, so a plan that changes
// between proposal and confirm also fails the pending-action payload hash.

function assertManageUsers(ctx: ActionContext): void {
  if (!hasPermission(ctx.principal.role, "manageUsers")) throw new McpError("forbidden");
}

/** Same rule as lifecycle-actions.ts visibleInRoot: in this root, or with no membership at all. */
async function visibleInRoot(userId: string, rootId: string): Promise<boolean> {
  if (await isUserInRoot(userId, rootId)) return true;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  return (row?.n ?? 0) === 0;
}

const shareShape = {
  shareNumerator: z.number().int().min(1).max(1_000_000).describe("Share of the unit, numerator."),
  shareDenominator: z.number().int().min(1).max(1_000_000).describe("Share of the unit, denominator."),
};

export const transferUnitOwnershipSchema = z.object({
  unitId: uuidSchema.describe("Unit id from list_units."),
  fromUserIds: z
    .array(uuidSchema)
    .min(1)
    .max(20)
    .describe("Current owners who leave (from list_units owners). A co-owner who stays is NOT listed."),
  toUsers: z
    .array(z.object({ userId: uuidSchema.describe("Existing person in this community."), ...shareShape }))
    .max(20)
    .optional()
    .describe("New owners who already exist in the app, with their share of the unit."),
  toNewOwners: z
    .array(z.object({ name: z.string().trim().min(1).max(255).describe("Full name."), ...shareShape }))
    .max(20)
    .optional()
    .describe("New owners not in the app yet: created as owner records without login (no invitation)."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Effective date of the change (YYYY-MM-DD, e.g. the cadastre entry date); not in the future."),
  kind: z.enum(TRANSFER_KINDS).optional().describe("sale (default) | inheritance | gift | correction."),
  note: z.string().trim().max(2000).optional().describe("Optional note (e.g. cadastre proceeding number)."),
});

type TransferPayload = z.infer<typeof transferUnitOwnershipSchema> & {
  /** Impact-plan hash computed by validate (never taken from the caller). */
  planHash?: string;
};

function toInput(ctx: ActionContext, p: TransferPayload): TransferInput {
  return {
    rootId: ctx.root.id,
    unitId: p.unitId,
    sellerUserIds: [...p.fromUserIds],
    buyers: (p.toUsers ?? []).map((b) => ({
      userId: b.userId,
      shareNum: b.shareNumerator,
      shareDen: b.shareDenominator,
    })),
    newBuyers: (p.toNewOwners ?? []).map((b) => ({
      name: b.name.trim(),
      shareNum: b.shareNumerator,
      shareDen: b.shareDenominator,
    })),
    date: p.date,
    kind: p.kind ?? "sale",
    note: p.note?.trim() || null,
  };
}

/** Lifecycle error code → the argument it concerns (validation.<field>). */
const FIELD_OF: Partial<Record<LifecycleErrorCode, string>> = {
  not_found: "unitId",
  invalid_input: "kind",
  transfer_date_in_future: "date",
  transfer_date_invalid: "date",
  transfer_date_before_start: "date",
  transfer_no_sellers: "fromUserIds",
  transfer_seller_not_owner: "fromUserIds",
  transfer_buyer_already_owner: "toUsers",
  transfer_buyer_invalid: "toUsers",
  share_sum_not_one: "toUsers",
  invalid_share: "toUsers",
};

function lifecycleError(code: LifecycleErrorCode): McpError {
  if (code === "forbidden") return new McpError("forbidden");
  if (code === "plan_stale") return new McpError("conflict.state_changed");
  if (code === "failed") return new McpError("internal");
  return validationError(FIELD_OF[code] ?? "input", { reason: code });
}

async function plan(ctx: ActionContext, p: TransferPayload): Promise<ImpactPlan> {
  const r = await planTransfer(toInput(ctx, p));
  if (!r.ok) throw lifecycleError(r.error);
  return r.plan;
}

const transferUnitOwnership = defineAction<TransferPayload>({
  kind: "transfer_unit_ownership",
  scopes: ["read", "governance:write"],
  schema: transferUnitOwnershipSchema as unknown as z.ZodType<TransferPayload>,
  authorize: assertManageUsers,
  async validate(ctx, p) {
    if ((p.toUsers?.length ?? 0) + (p.toNewOwners?.length ?? 0) === 0) {
      throw validationError("toUsers", { reason: "no_new_owner" });
    }
    for (const id of p.fromUserIds) {
      if (!(await visibleInRoot(id, ctx.root.id))) throw validationError("fromUserIds", { reason: "not_in_community" });
    }
    for (const b of p.toUsers ?? []) {
      if (!(await visibleInRoot(b.userId, ctx.root.id))) throw validationError("toUsers", { reason: "not_in_community" });
    }
    const normalised: TransferPayload = {
      unitId: p.unitId,
      fromUserIds: [...new Set(p.fromUserIds)],
      ...(p.toUsers?.length ? { toUsers: p.toUsers } : {}),
      ...(p.toNewOwners?.length
        ? { toNewOwners: p.toNewOwners.map((b) => ({ ...b, name: b.name.trim() })) }
        : {}),
      date: p.date,
      kind: p.kind ?? "sale",
      ...(p.note?.trim() ? { note: p.note.trim() } : {}),
    };
    const impact = await plan(ctx, normalised);
    // Pinned into the payload: if the plan changes before confirm, the
    // pending-action payload hash no longer matches (conflict.state_changed).
    return { ...normalised, planHash: impact.hash };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const impact = await plan(ctx, p);
    const s = impact.summary as Record<string, string | number>;
    const kind = t(`OwnerLifecycle.kinds.${p.kind ?? "sale"}`);
    const date = fmtDate(p.date, locale);

    const buyerNames = await Promise.all(
      (p.toUsers ?? []).map(async (b) => (await getUserAuthRow(b.userId))?.name ?? "—")
    );
    const newOwnerSuffix = t("OwnerLifecycle.newOwnerChip");
    const buyerLines = [
      ...(p.toUsers ?? []).map((b, i) => `${buyerNames[i]} (${b.shareNumerator}/${b.shareDenominator})`),
      ...(p.toNewOwners ?? []).map(
        (b) => `${b.name} (${b.shareNumerator}/${b.shareDenominator}, ${newOwnerSuffix})`
      ),
    ];

    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.unit"), value: String(s.unit ?? "—"), untrusted: true },
      { label: t("Mcp.preview.transferFrom"), value: String(s.sellers ?? "—"), untrusted: true },
      { label: t("Mcp.preview.transferTo"), value: buyerLines.join(", "), untrusted: true },
      { label: t("Mcp.preview.transferDate"), value: date },
      { label: t("Mcp.preview.transferKind"), value: kind },
      ...(p.note ? [{ label: t("Mcp.preview.note"), value: p.note, untrusted: true }] : []),
    ];

    const consequences = [
      t("OwnerLifecycle.summary.transfer", {
        sellers: String(s.sellers ?? ""),
        unit: String(s.unit ?? ""),
        date,
        kind,
        buyers: String(s.buyers ?? ""),
      }),
      t("Mcp.consequences.transferHistoryKept"),
    ];
    for (const line of impact.keep) {
      if (line.count > 0) {
        consequences.push(
          `${t("OwnerLifecycle.groups.keep")}: ${t(`OwnerLifecycle.lines.${line.key}`, { count: line.count })}`
        );
      }
    }
    if ((p.toNewOwners?.length ?? 0) > 0) consequences.push(t("Mcp.consequences.ownerCreatedNoInvite"));

    const warnings = impact.warnings.map((w) =>
      t(`OwnerLifecycle.warnings.${w.code}`, (w.params ?? {}) as Record<string, string | number>)
    );

    return {
      title: t("Mcp.actions.transfer_unit_ownership.title"),
      summary: t("Mcp.actions.transfer_unit_ownership.summary", {
        unit: String(s.unit ?? ""),
        date,
      }),
      rows,
      consequences,
      warnings,
    };
  },
  async commit(ctx, p) {
    // confirmAction already refuses in read-only mode; kept explicit like
    // the web action's assertWritable().
    if (isReadonly()) throw new McpError("forbidden", { reason: "read_only" });
    if (!p.planHash) throw new McpError("conflict.state_changed");
    const r = await transferOwnership(toInput(ctx, p), ctx.principal.userId, p.planHash);
    if (!r.ok) throw lifecycleError(r.error);
    return {
      data: { transferId: r.transferId, unitId: p.unitId },
      path: "/owners",
    };
  },
});

export const TRANSFER_ACTIONS = [transferUnitOwnership];

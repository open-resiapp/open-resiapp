import "server-only";

import { z } from "zod";

import type { InboxItem, OwnerFlat, OwnerRow, OwnersBoardData } from "@/lib/owners-board";
import { loadOwnersBoard } from "@/lib/owners-board.server";
import { nameSimilarity } from "@/lib/name-match";
import { hasPermission } from "@/lib/permissions";
import { unitHolderRoleFor } from "@/lib/role-options";
import {
  approvePendingRegistration,
  rejectPendingRegistration,
} from "@/lib/registration-review.server";
import { mergeShellIntoUser, ShellMergeError } from "@/lib/shell-merge";
import { McpError, validationError } from "../errors";
import { uuidSchema } from "../tools/helpers";
import { fmtDate, translatorFor } from "./format";
import { defineAction, type ActionContext, type PreviewRow, type Translator } from "./types";

// Self-registration review + owner-record ↔ account linking, mirroring the
// owners inbox (OwnersInbox / ShellMergeDialog / owner-requests.ts):
//   - "Schváliť"  → approvePendingRegistration {flatId: null, role: owner}
//   - "Spojiť"    → mergeShellIntoUser(shell → account), then approve
//   - "Zamietnuť" → rejectPendingRegistration
// Same permission as the web routes (manageUsers). Neither path e-mails
// the person. Population and suggestions come from loadOwnersBoard, so the
// model sees exactly what the inbox shows.

// Same name-similarity threshold the owners inbox uses for suggestions.
const NAME_MATCH_THRESHOLD = 0.5;

function assertManageUsers(ctx: ActionContext): void {
  if (!hasPermission(ctx.principal.role, "manageUsers")) throw new McpError("forbidden");
}

function flatLabel(f: OwnerFlat): string {
  const unit = [f.entranceName, f.flatNumber].filter(Boolean).join(" / ");
  return `${unit} (${f.shareNum}/${f.shareDen})`;
}

function flatsText(flats: OwnerFlat[], t: Translator): string {
  return flats.length ? flats.map(flatLabel).join(", ") : t("Mcp.preview.noUnits");
}

/** Units of the merged account: its own flats plus the record's (merge drops duplicates). */
function mergedFlats(account: OwnerFlat[], shell: OwnerFlat[]): OwnerFlat[] {
  const seen = new Set(account.map((f) => f.unitId));
  return [...account, ...shell.filter((f) => !seen.has(f.unitId))];
}

function pendingRegistration(board: OwnersBoardData, id: string): InboxItem {
  const item = board.inbox.find((i) => i.id === id);
  if (!item) throw validationError("registrationId", { reason: "registration_not_pending" });
  return item;
}

/**
 * An owner record the shell merge accepts: no login, no e-mail, pending.
 * mergeShellIntoUser rejects records with an e-mail — surfaced as its own
 * reason so the model can tell the user why.
 */
function mergeableOwnerRecord(board: OwnersBoardData, id: string, field: string): OwnerRow {
  const p = board.people.find((x) => x.id === id);
  if (!p) throw validationError(field, { reason: "owner_not_found" });
  if (p.status !== "no_account" && p.status !== "invited") {
    throw validationError(field, { reason: "owner_has_login" });
  }
  if (p.email !== null) throw validationError(field, { reason: "owner_has_email" });
  if (!p.mergeable) throw validationError(field, { reason: "owner_not_pending" });
  return p;
}

/** An account with a login in this community (active, or a pending registration). */
function linkableAccount(board: OwnersBoardData, id: string): OwnerRow {
  const p = board.people.find((x) => x.id === id);
  if (!p) throw validationError("accountUserId", { reason: "account_not_found" });
  if (p.status !== "active" && p.status !== "pending") {
    throw validationError("accountUserId", { reason: "account_has_no_login" });
  }
  return p;
}

/**
 * Merge, and approve when `approve` — one transaction, the inbox's
 * mergeAndApprove. A lost approval (no longer pending) rolls the merge back.
 */
async function mergeAndApprove(ctx: ActionContext, shellId: string, accountId: string, approve: boolean) {
  try {
    await mergeShellIntoUser(shellId, accountId, ctx.principal.userId, {
      approvePendingAsOwner: approve,
    });
  } catch (err) {
    // validate() ran right before commit, so a refusal here is a race.
    if (err instanceof ShellMergeError) throw new McpError("conflict.state_changed");
    throw err;
  }
}

function namesDiffer(a: string, b: string): boolean {
  return nameSimilarity(a, b) < NAME_MATCH_THRESHOLD;
}

// ── approve_registration ─────────────────────────────────────────────────

export const approveRegistrationSchema = z.object({
  registrationId: uuidSchema.describe("Pending registration id from list_pending_registrations."),
  linkToOwnerId: uuidSchema
    .optional()
    .describe(
      "Owner record without login (e.g. from the import) to merge into this account before approving — its units and shares move to the account. Omit for a plain approval."
    ),
});

type ApprovePayload = z.infer<typeof approveRegistrationSchema>;

const approveRegistration = defineAction<ApprovePayload>({
  kind: "approve_registration",
  scopes: ["read", "governance:write"],
  schema: approveRegistrationSchema,
  authorize: assertManageUsers,
  async validate(ctx, p) {
    const board = await loadOwnersBoard(ctx.root.id);
    pendingRegistration(board, p.registrationId);
    if (p.linkToOwnerId) {
      if (p.linkToOwnerId === p.registrationId) {
        throw validationError("linkToOwnerId", { reason: "same_person" });
      }
      mergeableOwnerRecord(board, p.linkToOwnerId, "linkToOwnerId");
    }
    return {
      registrationId: p.registrationId,
      ...(p.linkToOwnerId ? { linkToOwnerId: p.linkToOwnerId } : {}),
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const board = await loadOwnersBoard(ctx.root.id);
    const reg = pendingRegistration(board, p.registrationId);
    const shell = p.linkToOwnerId
      ? mergeableOwnerRecord(board, p.linkToOwnerId, "linkToOwnerId")
      : null;
    const after = shell ? mergedFlats(reg.flats, shell.flats) : reg.flats;

    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.person"), value: reg.name, untrusted: true },
      { label: t("Mcp.preview.email"), value: reg.email, untrusted: true },
      { label: t("Mcp.preview.registeredAt"), value: fmtDate(reg.createdAt, locale) },
      ...(shell
        ? [
            { label: t("Mcp.preview.ownerRecord"), value: shell.name, untrusted: true },
            { label: t("Mcp.preview.ownerRecordUnits"), value: flatsText(shell.flats, t), untrusted: true },
          ]
        : []),
      { label: t("Mcp.preview.unitsAfter"), value: flatsText(after, t), untrusted: true },
    ];

    const consequences: string[] = [];
    if (shell) consequences.push(t("Mcp.consequences.mergeOwnerRecord", { name: shell.name }));
    consequences.push(t("Mcp.consequences.accessGranted"), t("Mcp.consequences.noEmailSent"));

    const warnings: string[] = [];
    if (!reg.emailVerified) warnings.push(t("Mcp.warnings.emailNotVerified"));
    if (shell && namesDiffer(reg.name, shell.name)) warnings.push(t("Mcp.warnings.namesDiffer"));
    if (!shell && reg.suggestion) {
      warnings.push(t("Mcp.warnings.suggestedOwnerRecord", { name: reg.suggestion.shellName }));
    }
    if (after.length === 0) warnings.push(t("Mcp.warnings.approveWithoutUnit"));

    return {
      title: t("Mcp.actions.approve_registration.title"),
      summary: shell
        ? t("Mcp.actions.approve_registration.summaryLink", { name: reg.name, owner: shell.name })
        : t("Mcp.actions.approve_registration.summary", { name: reg.name }),
      rows,
      consequences,
      warnings,
    };
  },
  async commit(ctx, p) {
    if (p.linkToOwnerId) {
      await mergeAndApprove(ctx, p.linkToOwnerId, p.registrationId, true);
    } else {
      const res = await approvePendingRegistration({
        userId: p.registrationId,
        flatId: null,
        // Unit holder role follows the community: člen in a bytové družstvo.
        role: unitHolderRoleFor(ctx.root.templateSlug),
      });
      if (!res.ok) {
        if (res.error === "not_found") throw new McpError("conflict.state_changed");
        throw new McpError("internal");
      }
    }
    return {
      data: { userId: p.registrationId, mergedOwnerId: p.linkToOwnerId ?? null },
      path: `/owners/${p.registrationId}`,
    };
  },
});

// ── reject_registration ──────────────────────────────────────────────────

export const rejectRegistrationSchema = z.object({
  registrationId: uuidSchema.describe("Pending registration id from list_pending_registrations."),
});

type RejectPayload = z.infer<typeof rejectRegistrationSchema>;

const rejectRegistration = defineAction<RejectPayload>({
  kind: "reject_registration",
  scopes: ["read", "governance:write"],
  schema: rejectRegistrationSchema,
  authorize: assertManageUsers,
  async validate(ctx, p) {
    pendingRegistration(await loadOwnersBoard(ctx.root.id), p.registrationId);
    return { registrationId: p.registrationId };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const reg = pendingRegistration(await loadOwnersBoard(ctx.root.id), p.registrationId);
    return {
      title: t("Mcp.actions.reject_registration.title"),
      summary: t("Mcp.actions.reject_registration.summary", { name: reg.name }),
      rows: [
        { label: t("Mcp.preview.person"), value: reg.name, untrusted: true },
        { label: t("Mcp.preview.email"), value: reg.email, untrusted: true },
        { label: t("Mcp.preview.registeredAt"), value: fmtDate(reg.createdAt, locale) },
      ],
      consequences: [
        t("Mcp.consequences.rejectBlocksLogin"),
        t("Mcp.consequences.rejectEmailBlocked"),
        t("Mcp.consequences.noEmailSent"),
      ],
      warnings: [],
    };
  },
  async commit(_ctx, p) {
    if (!(await rejectPendingRegistration(p.registrationId))) {
      throw new McpError("conflict.state_changed");
    }
    return { data: { userId: p.registrationId }, path: "/owners" };
  },
});

// ── link_owner_account ───────────────────────────────────────────────────

export const linkOwnerAccountSchema = z.object({
  ownerId: uuidSchema.describe("Owner record WITHOUT login (status no_account / invited in list_units)."),
  accountUserId: uuidSchema.describe(
    "Person WITH an account in this community: active, or a pending registration (list_pending_registrations)."
  ),
});

type LinkPayload = z.infer<typeof linkOwnerAccountSchema>;

const linkOwnerAccount = defineAction<LinkPayload>({
  kind: "link_owner_account",
  scopes: ["read", "governance:write"],
  schema: linkOwnerAccountSchema,
  authorize: assertManageUsers,
  async validate(ctx, p) {
    if (p.ownerId === p.accountUserId) {
      throw validationError("accountUserId", { reason: "same_person" });
    }
    const board = await loadOwnersBoard(ctx.root.id);
    mergeableOwnerRecord(board, p.ownerId, "ownerId");
    linkableAccount(board, p.accountUserId);
    return { ownerId: p.ownerId, accountUserId: p.accountUserId };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const board = await loadOwnersBoard(ctx.root.id);
    const shell = mergeableOwnerRecord(board, p.ownerId, "ownerId");
    const account = linkableAccount(board, p.accountUserId);
    const pending = account.status === "pending";

    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.ownerRecord"), value: shell.name, untrusted: true },
      { label: t("Mcp.preview.ownerRecordUnits"), value: flatsText(shell.flats, t), untrusted: true },
      { label: t("Mcp.preview.account"), value: account.name, untrusted: true },
      ...(account.email ? [{ label: t("Mcp.preview.email"), value: account.email, untrusted: true }] : []),
      {
        label: t("Mcp.preview.accountStatus"),
        value: t(pending ? "Mcp.preview.accountStatus_pending" : "Mcp.preview.accountStatus_active"),
      },
      {
        label: t("Mcp.preview.unitsAfter"),
        value: flatsText(mergedFlats(account.flats, shell.flats), t),
        untrusted: true,
      },
    ];

    const consequences = [t("Mcp.consequences.mergeOwnerRecord", { name: shell.name })];
    if (pending) consequences.push(t("Mcp.consequences.accessGranted"));
    consequences.push(t("Mcp.consequences.noEmailSent"));

    const warnings: string[] = [];
    if (namesDiffer(account.name, shell.name)) warnings.push(t("Mcp.warnings.namesDiffer"));
    if (pending && !account.emailVerified) warnings.push(t("Mcp.warnings.emailNotVerified"));

    return {
      title: t("Mcp.actions.link_owner_account.title"),
      summary: t(
        pending ? "Mcp.actions.link_owner_account.summaryApprove" : "Mcp.actions.link_owner_account.summary",
        { owner: shell.name, name: account.name }
      ),
      rows,
      consequences,
      warnings,
    };
  },
  async commit(ctx, p) {
    // Approve only when the account is still pending — read now, after the
    // confirm-time validate, like the inbox decides from its current list.
    const board = await loadOwnersBoard(ctx.root.id);
    const pending = linkableAccount(board, p.accountUserId).status === "pending";
    await mergeAndApprove(ctx, p.ownerId, p.accountUserId, pending);
    return {
      data: { userId: p.accountUserId, mergedOwnerId: p.ownerId, approved: pending },
      path: `/owners/${p.accountUserId}`,
    };
  },
});


// ── link_owner_accounts (batch) ──────────────────────────────────────────
//
// After an import, many owner records need linking to the accounts people
// registered with. One proposal / one confirm; all-or-nothing at propose
// (per-item codes), each item commits through the same merge at confirm.

const LINK_BATCH_MAX = 50;

export const linkOwnerAccountsSchema = z.object({
  items: z
    .array(linkOwnerAccountSchema)
    .min(1)
    .max(LINK_BATCH_MAX)
    .describe(`Up to ${LINK_BATCH_MAX} {ownerId, accountUserId} pairs; each ownerId at most once.`),
});

type LinkBatchPayload = z.infer<typeof linkOwnerAccountsSchema>;

function linkItemCode(err: unknown): string {
  if (!(err instanceof McpError)) throw err;
  const reason = err.details?.reason;
  return typeof reason === "string" ? reason : err.code;
}

const linkOwnerAccounts = defineAction<LinkBatchPayload>({
  kind: "link_owner_accounts",
  scopes: ["read", "governance:write"],
  schema: linkOwnerAccountsSchema,
  authorize: assertManageUsers,
  async validate(ctx, p) {
    const board = await loadOwnersBoard(ctx.root.id);
    const owners = new Set(p.items.map((it) => it.ownerId));
    const errors: { item: number; ownerId: string; code: string }[] = [];
    const seen = new Set<string>();
    for (const [i, it] of p.items.entries()) {
      if (seen.has(it.ownerId)) {
        errors.push({ item: i, ownerId: it.ownerId, code: "duplicate_owner" });
        continue;
      }
      seen.add(it.ownerId);
      // A record merged away in this batch cannot also be a target.
      if (owners.has(it.accountUserId)) {
        errors.push({ item: i, ownerId: it.ownerId, code: "account_is_merged_in_batch" });
        continue;
      }
      try {
        if (it.ownerId === it.accountUserId) {
          throw validationError("accountUserId", { reason: "same_person" });
        }
        mergeableOwnerRecord(board, it.ownerId, "ownerId");
        linkableAccount(board, it.accountUserId);
      } catch (err) {
        errors.push({ item: i, ownerId: it.ownerId, code: linkItemCode(err) });
      }
    }
    if (errors.length > 0) throw validationError("items", { reason: "invalid_items", errors });
    return { items: p.items.map((it) => ({ ownerId: it.ownerId, accountUserId: it.accountUserId })) };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const board = await loadOwnersBoard(ctx.root.id);
    const rows: PreviewRow[] = [{ label: t("Mcp.preview.linkCount"), value: String(p.items.length) }];
    const warnings: string[] = [];
    let approvals = 0;
    const approved = new Set<string>();
    p.items.forEach((it, i) => {
      const shell = mergeableOwnerRecord(board, it.ownerId, "ownerId");
      const account = linkableAccount(board, it.accountUserId);
      const approve = account.status === "pending" && !approved.has(account.id);
      if (approve) {
        approved.add(account.id);
        approvals += 1;
      }
      rows.push({
        label: t("Mcp.preview.linkN", { n: i + 1 }),
        value: t(approve ? "Mcp.preview.linkLineApprove" : "Mcp.preview.linkLine", {
          owner: shell.name,
          units: flatsText(shell.flats, t),
          name: account.name,
        }),
        untrusted: true,
      });
      if (namesDiffer(account.name, shell.name)) {
        warnings.push(t("Mcp.warnings.namesDifferItem", { n: i + 1, owner: shell.name, name: account.name }));
      }
      if (approve && !account.emailVerified) {
        warnings.push(t("Mcp.warnings.emailNotVerifiedItem", { n: i + 1, name: account.name }));
      }
    });
    const consequences = [t("Mcp.consequences.mergeOwnerRecords", { count: p.items.length })];
    if (approvals > 0) consequences.push(t("Mcp.consequences.accessGrantedCount", { count: approvals }));
    consequences.push(t("Mcp.consequences.noEmailSent"), t("Mcp.consequences.batchPerItem"));
    return {
      title: t("Mcp.actions.link_owner_accounts.title"),
      summary: t("Mcp.actions.link_owner_accounts.summary", { count: p.items.length }),
      rows,
      consequences,
      warnings,
    };
  },
  async commit(ctx, p) {
    // Pending status as of the confirm (validate just ran); an account the
    // batch already approved is active for its later items.
    const board = await loadOwnersBoard(ctx.root.id);
    const pendingAtStart = new Set(board.people.filter((x) => x.status === "pending").map((x) => x.id));
    const approved = new Set<string>();
    const failed: { item: number; ownerId: string; code: string }[] = [];
    let linked = 0;
    for (const [i, it] of p.items.entries()) {
      const approve = pendingAtStart.has(it.accountUserId) && !approved.has(it.accountUserId);
      try {
        await mergeAndApprove(ctx, it.ownerId, it.accountUserId, approve);
        if (approve) approved.add(it.accountUserId);
        linked += 1;
      } catch (err) {
        if (err instanceof McpError) {
          failed.push({ item: i, ownerId: it.ownerId, code: err.code });
          continue;
        }
        if (linked === 0) throw err;
        console.error(`[mcp] link_owner_accounts item ${i} failed:`, err);
        failed.push({ item: i, ownerId: it.ownerId, code: "internal" });
      }
    }
    if (linked === 0) throw new McpError("conflict.state_changed");
    return {
      data: { linked, approved: approved.size, failed },
      path: "/owners",
      ...(failed.length > 0
        ? {
            doneKey: "Mcp.actions.link_owner_accounts.donePartial",
            doneValues: { linked, total: p.items.length },
          }
        : {}),
    };
  },
});

export const REGISTRATION_ACTIONS = [
  approveRegistration,
  rejectRegistration,
  linkOwnerAccount,
  linkOwnerAccounts,
];

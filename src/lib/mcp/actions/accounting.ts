import "server-only";

import { z } from "zod";

import {
  getBankLineState,
  getDomUnitLabel,
  getInboxItemState,
  getPeriodStatus,
  getServiceCategory,
  getZavierkaVoteRef,
} from "@modules/accounting/src/lib/action-lookups";
import {
  assertApprover,
  assertUnitLedger,
  assertWriter,
} from "@modules/accounting/src/lib/authz-assert";
import { confirmBankLineMatch } from "@modules/accounting/src/lib/bank-import";
import { dismissInboxItem, postInboxItemAsExpense } from "@modules/accounting/src/lib/expense-inbox";
import { isValidIban, normalizeIban } from "@modules/accounting/src/lib/iban";
import {
  validateExpenseInput,
  validateManualPaymentInput,
  validateMatchInput,
  validateMeterReadingInput,
} from "@modules/accounting/src/lib/input-validators";
import { listUnitBalances } from "@modules/accounting/src/lib/karta-bytu";
import { createReading, listReadingsForUnit, METER_TYPES } from "@modules/accounting/src/lib/meters";
import { createManualPayment } from "@modules/accounting/src/lib/payments";
import { approveZavierka } from "@modules/accounting/src/lib/zavierka";
import { McpError, validationError } from "../errors";
import {
  fmtDate,
  fmtMilli,
  fmtMoney,
  mcpJustification,
  translatorFor,
} from "./format";
import { defineAction, type ActionContext, type PreviewRow } from "./types";

// Accounting pending actions (BYT-20261117-001 §4 #23–#28). Validation is
// the same shared validator the UI route uses; commit is the same lib
// function with actorId = the real user and an "MCP: <client>" audit note.

const uuid = z.string().uuid();
const isoDate = z.string().min(8).max(40);

/** Shared validator field names → MCP tool argument names. */
const FIELD_ALIAS: Record<string, string> = { unitEntityId: "unitId" };
function fieldError(field: string): McpError {
  return validationError(FIELD_ALIAS[field] ?? field);
}

async function unitOrThrow(ctx: ActionContext, unitId: string) {
  const unit = await getDomUnitLabel(ctx.root.id, unitId);
  if (!unit) throw validationError("unitId");
  return unit;
}

async function unitBalance(ctx: ActionContext, unitId: string): Promise<number> {
  const m = await listUnitBalances(ctx.root.id, ctx.root.country, [unitId]);
  return m.get(unitId) ?? 0;
}

const notFutureIso = (raw: string, field: string): string => {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw validationError(field);
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw validationError(field, { reason: "future" });
  return d.toISOString();
};

// ── #23 match_payment ────────────────────────────────────────────────────

export const matchPaymentSchema = z.object({
  paymentId: uuid.describe("Bank line id (paymentId from list_unmatched_payments)."),
  unitId: uuid.describe("Unit to credit the payment to."),
});

const matchPayment = defineAction({
  kind: "match_payment",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: matchPaymentSchema,
  authorize: (ctx) => assertWriter(ctx.principal),
  async validate(ctx, p) {
    const v = validateMatchInput({ unitEntityId: p.unitId });
    if (!v.ok) throw fieldError(v.field);
    const line = await getBankLineState(ctx.root.id, p.paymentId);
    if (!line) throw new McpError("not_found");
    if (line.source !== "bank_import" && line.source !== "fio_api") throw validationError("paymentId");
    if (line.voided || line.matched) throw new McpError("conflict.state_changed");
    await unitOrThrow(ctx, p.unitId);
    return p;
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const [line, unit, balance] = await Promise.all([
      getBankLineState(ctx.root.id, p.paymentId),
      unitOrThrow(ctx, p.unitId),
      unitBalance(ctx, p.unitId),
    ]);
    if (!line) throw new McpError("not_found");
    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.amount"), value: fmtMoney(line.amountCents, locale) },
      { label: t("Mcp.preview.receivedAt"), value: fmtDate(line.receivedAt, locale) },
      { label: t("Mcp.preview.vs"), value: line.vs ?? "—" },
      { label: t("Mcp.preview.counterparty"), value: line.counterpartyName ?? "—", untrusted: true },
      { label: t("Mcp.preview.narrative"), value: line.narrative ?? "—", untrusted: true },
      { label: t("Mcp.preview.unit"), before: t("Mcp.preview.unmatched"), after: unit.label },
      {
        label: t("Mcp.preview.unitBalance"),
        before: fmtMoney(balance, locale),
        after: fmtMoney(balance - line.amountCents, locale),
      },
    ];
    return {
      title: t("Mcp.actions.match_payment.title"),
      summary: t("Mcp.actions.match_payment.summary", {
        amount: fmtMoney(line.amountCents, locale),
        unit: unit.label,
      }),
      rows,
      consequences: [t("Mcp.consequences.allocatePayment")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    await confirmBankLineMatch({
      entityId: ctx.root.id,
      country: ctx.root.country,
      paymentId: p.paymentId,
      unitEntityId: p.unitId,
      actorId: ctx.principal.userId,
      justification: mcpJustification(ctx),
    });
    return { data: { paymentId: p.paymentId, unitId: p.unitId }, path: `/accounting/karta/${p.unitId}` };
  },
});

// ── #24 record_payment ───────────────────────────────────────────────────

export const recordPaymentSchema = z.object({
  unitId: uuid.describe("Unit that paid."),
  amountCents: z.number().int().positive().max(100_000_000).describe("Amount in cents (> 0)."),
  receivedAt: isoDate.optional().describe("Date the money arrived (ISO 8601); defaults to now."),
  method: z.enum(["bank", "cash"]).describe("bank = bank account (221), cash = cash box (211)."),
  note: z.string().max(500).optional().describe("Optional note stored with the payment."),
});

const recordPayment = defineAction({
  kind: "record_payment",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: recordPaymentSchema,
  authorize: (ctx) => assertWriter(ctx.principal),
  async validate(ctx, p) {
    const v = validateManualPaymentInput({
      unitEntityId: p.unitId,
      amountCents: p.amountCents,
      receivedAt: p.receivedAt,
      method: p.method,
      note: p.note,
    });
    if (!v.ok) throw fieldError(v.field);
    await unitOrThrow(ctx, p.unitId);
    // Pin the resolved date so confirm commits exactly what was previewed.
    return { ...p, receivedAt: v.value.receivedAt.toISOString(), note: p.note?.trim() || undefined };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const [unit, balance] = await Promise.all([unitOrThrow(ctx, p.unitId), unitBalance(ctx, p.unitId)]);
    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.unit"), value: unit.label },
      { label: t("Mcp.preview.amount"), value: fmtMoney(p.amountCents, locale) },
      { label: t("Mcp.preview.receivedAt"), value: fmtDate(p.receivedAt!, locale) },
      { label: t("Mcp.preview.method"), value: t(`Mcp.preview.method_${p.method}`) },
      ...(p.note ? [{ label: t("Mcp.preview.note"), value: p.note, untrusted: true }] : []),
      {
        label: t("Mcp.preview.unitBalance"),
        before: fmtMoney(balance, locale),
        after: fmtMoney(balance - p.amountCents, locale),
      },
    ];
    return {
      title: t("Mcp.actions.record_payment.title"),
      summary: t("Mcp.actions.record_payment.summary", {
        amount: fmtMoney(p.amountCents, locale),
        unit: unit.label,
      }),
      rows,
      consequences: [t("Mcp.consequences.allocatePayment")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    const r = await createManualPayment({
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.principal.userId,
      unitEntityId: p.unitId,
      amountCents: p.amountCents,
      receivedAt: new Date(p.receivedAt!),
      method: p.method,
      note: p.note,
      justification: mcpJustification(ctx),
    });
    return {
      data: { paymentId: r.paymentId, allocatedCents: r.allocatedCents, unallocatedCents: r.unallocatedCents },
      path: `/accounting/karta/${p.unitId}`,
    };
  },
});

// ── #25 post_expense_from_inbox ──────────────────────────────────────────

export const postExpenseSchema = z.object({
  inboxId: uuid.describe("Inbox item id (from list_expense_inbox)."),
  supplierName: z.string().min(1).max(255),
  supplierIco: z.string().min(1).max(20).describe("Supplier IČO."),
  supplierDic: z.string().min(1).max(20).describe("Supplier DIČ."),
  supplierIban: z.string().min(1).max(40).describe("Supplier IBAN (payee account)."),
  invoiceNo: z.string().min(1).max(100),
  invoiceDate: isoDate.describe("Invoice issue date (ISO 8601)."),
  dueDate: isoDate.optional().describe("Due date (ISO 8601)."),
  serviceCategoryId: uuid.optional().describe("Service category id; omit when uncategorised."),
  okruh: z.enum(["fpuo", "svc"]).describe("fpuo = repair fund, svc = services (billed to owners)."),
  amountCents: z.number().int().positive().max(1_000_000_000).describe("Gross (brutto) amount in cents."),
  amountNettoCents: z.number().int().min(0).max(1_000_000_000).describe("Net amount in cents."),
  dphCents: z.number().int().min(0).max(1_000_000_000).describe("VAT amount in cents; netto + DPH must equal brutto."),
  dphRateBp: z.number().int().min(0).max(3000).optional().describe("VAT rate in basis points (2300 = 23 %)."),
  nextInspectionDueAt: isoDate.optional().describe("Next statutory revision date, for revision invoices."),
  isRecurring: z.boolean().optional().describe("Monthly recurring commitment."),
});

const postExpenseFromInbox = defineAction({
  kind: "post_expense_from_inbox",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: postExpenseSchema,
  authorize: (ctx) => assertWriter(ctx.principal),
  async validate(ctx, p) {
    const v = validateExpenseInput({ ...p });
    if (!v.ok) throw fieldError(v.field);
    const iban = normalizeIban(p.supplierIban);
    if (!iban || !isValidIban(iban)) throw validationError("supplierIban");
    if (p.dueDate && Number.isNaN(new Date(p.dueDate).getTime())) throw validationError("dueDate");
    if (p.nextInspectionDueAt && Number.isNaN(new Date(p.nextInspectionDueAt).getTime())) {
      throw validationError("nextInspectionDueAt");
    }
    if (p.serviceCategoryId) {
      const cat = await getServiceCategory(p.serviceCategoryId, ctx.root.country);
      if (!cat) throw validationError("serviceCategoryId");
    }
    const item = await getInboxItemState(ctx.root.id, p.inboxId);
    if (!item) throw new McpError("not_found");
    if (item.status !== "pending") throw new McpError("conflict.state_changed");
    return {
      ...p,
      supplierName: v.value.supplierName,
      supplierIco: v.value.supplierIco,
      supplierDic: v.value.supplierDic,
      supplierIban: v.value.supplierIban,
      invoiceNo: v.value.invoiceNo,
      invoiceDate: v.value.invoiceDate.toISOString(),
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const [item, cat] = await Promise.all([
      getInboxItemState(ctx.root.id, p.inboxId),
      p.serviceCategoryId ? getServiceCategory(p.serviceCategoryId, ctx.root.country) : null,
    ]);
    if (!item) throw new McpError("not_found");
    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.file"), value: item.fileName, untrusted: true },
      { label: t("Mcp.preview.supplier"), value: p.supplierName, untrusted: true },
      { label: t("Mcp.preview.ico"), value: p.supplierIco },
      { label: t("Mcp.preview.dic"), value: p.supplierDic },
      { label: t("Mcp.preview.iban"), value: p.supplierIban },
      { label: t("Mcp.preview.invoiceNo"), value: p.invoiceNo, untrusted: true },
      { label: t("Mcp.preview.invoiceDate"), value: fmtDate(p.invoiceDate, locale) },
      ...(p.dueDate ? [{ label: t("Mcp.preview.dueDate"), value: fmtDate(p.dueDate, locale) }] : []),
      {
        label: t("Mcp.preview.category"),
        value: cat ? t(`Accounting.serviceCategories.${cat.slug}`) : t("Mcp.preview.uncategorized"),
      },
      { label: t("Mcp.preview.okruh"), value: t(`Mcp.preview.okruh_${p.okruh}`) },
      { label: t("Mcp.preview.netto"), value: fmtMoney(p.amountNettoCents, locale) },
      {
        label: t("Mcp.preview.dph"),
        value:
          p.dphRateBp != null
            ? `${fmtMoney(p.dphCents, locale)} (${(p.dphRateBp / 100).toLocaleString(locale)} %)`
            : fmtMoney(p.dphCents, locale),
      },
      { label: t("Mcp.preview.brutto"), value: fmtMoney(p.amountCents, locale) },
      { label: t("Mcp.preview.inboxStatus"), before: t("Mcp.preview.inboxPending"), after: t("Mcp.preview.inboxPosted") },
    ];
    const warnings: string[] = [];
    if (item.ocrAmountCents !== null && item.ocrAmountCents !== p.amountCents) {
      warnings.push(t("Mcp.warnings.ocrAmountMismatch", { ocr: fmtMoney(item.ocrAmountCents, locale) }));
    }
    return {
      title: t("Mcp.actions.post_expense_from_inbox.title"),
      summary: t("Mcp.actions.post_expense_from_inbox.summary", {
        amount: fmtMoney(p.amountCents, locale),
        invoiceNo: p.invoiceNo,
      }),
      rows,
      consequences: [
        t("Mcp.consequences.expenseBooked"),
        p.okruh === "fpuo" ? t("Mcp.consequences.expenseFromFund") : t("Mcp.consequences.expenseToSettlement"),
      ],
      warnings,
    };
  },
  async commit(ctx, p) {
    const r = await postInboxItemAsExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      id: p.inboxId,
      actorId: ctx.principal.userId,
      supplierName: p.supplierName,
      supplierIco: p.supplierIco,
      supplierDic: p.supplierDic,
      supplierIban: p.supplierIban,
      invoiceNo: p.invoiceNo,
      invoiceDate: new Date(p.invoiceDate),
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
      serviceCategoryId: p.serviceCategoryId ?? null,
      okruh: p.okruh,
      amountCents: p.amountCents,
      amountNettoCents: p.amountNettoCents,
      dphCents: p.dphCents,
      dphRateBp: p.dphRateBp ?? null,
      nextInspectionDueAt: p.nextInspectionDueAt ? new Date(p.nextInspectionDueAt) : null,
      isRecurring: p.isRecurring === true,
      justification: mcpJustification(ctx),
    });
    return { data: { expenseId: r.expenseId }, path: "/accounting/expenses" };
  },
});

// ── #26 dismiss_inbox_item ───────────────────────────────────────────────

export const dismissInboxSchema = z.object({
  inboxId: uuid.describe("Inbox item id (from list_expense_inbox)."),
});

const dismissInbox = defineAction({
  kind: "dismiss_inbox_item",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: dismissInboxSchema,
  authorize: (ctx) => assertWriter(ctx.principal),
  async validate(ctx, p) {
    const item = await getInboxItemState(ctx.root.id, p.inboxId);
    if (!item) throw new McpError("not_found");
    if (item.status !== "pending") throw new McpError("conflict.state_changed");
    return p;
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const item = await getInboxItemState(ctx.root.id, p.inboxId);
    if (!item) throw new McpError("not_found");
    return {
      title: t("Mcp.actions.dismiss_inbox_item.title"),
      summary: t("Mcp.actions.dismiss_inbox_item.summary", { file: item.fileName }),
      rows: [
        { label: t("Mcp.preview.file"), value: item.fileName, untrusted: true },
        ...(item.ocrAmountCents !== null
          ? [{ label: t("Mcp.preview.ocrAmount"), value: fmtMoney(item.ocrAmountCents, locale) }]
          : []),
        {
          label: t("Mcp.preview.inboxStatus"),
          before: t("Mcp.preview.inboxPending"),
          after: t("Mcp.preview.inboxDismissed"),
        },
      ],
      consequences: [t("Mcp.consequences.inboxDismissed")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    await dismissInboxItem({
      entityId: ctx.root.id,
      id: p.inboxId,
      actorId: ctx.principal.userId,
      justification: mcpJustification(ctx),
    });
    return { data: { inboxId: p.inboxId }, path: "/accounting/inbox" };
  },
});

// ── #27 submit_meter_reading ─────────────────────────────────────────────

export const meterReadingSchema = z.object({
  unitId: uuid.describe("Unit the meter belongs to."),
  meterType: z.enum(METER_TYPES as [string, ...string[]]).describe("heat | water_cold | water_hot | electricity."),
  readingDate: isoDate.describe("Date of the reading (ISO 8601), not in the future."),
  valueMilli: z.number().int().min(0).max(1_000_000_000_000).describe("Meter value × 1000 (12.345 m³ → 12345)."),
});

const submitMeterReading = defineAction({
  kind: "submit_meter_reading",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: meterReadingSchema,
  // Same access surface as the UI meters route: board readers/writers for
  // any unit, owners for their own units.
  authorize: (ctx, p) => assertUnitLedger(ctx.principal, p.unitId),
  async validate(ctx, p) {
    const v = validateMeterReadingInput({
      unitEntityId: p.unitId,
      meterType: p.meterType,
      readingDate: p.readingDate,
      valueMilli: p.valueMilli,
    });
    if (!v.ok) throw fieldError(v.field);
    const readingDate = notFutureIso(p.readingDate, "readingDate");
    await unitOrThrow(ctx, p.unitId);
    return { ...p, readingDate };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const [unit, readings] = await Promise.all([
      unitOrThrow(ctx, p.unitId),
      listReadingsForUnit(ctx.root.id, p.unitId),
    ]);
    const prev = readings.find((r) => r.meterType === p.meterType) ?? null;
    const warnings: string[] = [];
    if (prev && p.valueMilli < prev.valueMilli) {
      warnings.push(t("Mcp.warnings.readingLower", { previous: fmtMilli(prev.valueMilli, locale) }));
    }
    return {
      title: t("Mcp.actions.submit_meter_reading.title"),
      summary: t("Mcp.actions.submit_meter_reading.summary", {
        unit: unit.label,
        value: fmtMilli(p.valueMilli, locale),
      }),
      rows: [
        { label: t("Mcp.preview.unit"), value: unit.label },
        { label: t("Mcp.preview.meterType"), value: t(`Accounting.meters.type_${p.meterType}`) },
        { label: t("Mcp.preview.readingDate"), value: fmtDate(p.readingDate, locale) },
        {
          label: t("Mcp.preview.meterValue"),
          before: prev ? `${fmtMilli(prev.valueMilli, locale)} (${fmtDate(prev.readingDate, locale)})` : "—",
          after: fmtMilli(p.valueMilli, locale),
        },
      ],
      consequences: [t("Mcp.consequences.readingForSettlement")],
      warnings,
    };
  },
  async commit(ctx, p) {
    const r = await createReading({
      entityId: ctx.root.id,
      unitEntityId: p.unitId,
      meterType: p.meterType as (typeof METER_TYPES)[number],
      readingDate: new Date(p.readingDate),
      valueMilli: p.valueMilli,
      actorId: ctx.principal.userId,
      justification: mcpJustification(ctx),
    });
    return { data: { readingId: r.id }, path: "/accounting/meters" };
  },
});

// ── #28 approve_zavierka ─────────────────────────────────────────────────

export const approveZavierkaSchema = z.object({
  year: z.number().int().min(2000).max(2100).describe("Accounting year whose závierka is approved."),
  votingItemId: uuid.describe("Item of the CLOSED zhromaždenie voting that approved the accounts."),
});

const approveZavierkaAction = defineAction({
  kind: "approve_zavierka",
  module: "accounting",
  scopes: ["read", "finance:write"],
  schema: approveZavierkaSchema,
  // Separation of duties (AC 521): chairman / admin, never the treasurer.
  authorize: (ctx) => assertApprover(ctx.principal),
  async validate(ctx, p) {
    const status = await getPeriodStatus(ctx.root.id, p.year);
    if (!status) throw new McpError("not_found");
    if (status === "closed") throw new McpError("conflict.state_changed");
    if (status !== "published") throw validationError("year", { reason: "settlement_not_published" });
    const vote = await getZavierkaVoteRef(ctx.root.id, p.votingItemId);
    if (!vote) throw validationError("votingItemId");
    if (vote.status !== "closed") throw validationError("votingItemId", { reason: "vote_not_closed" });
    return p;
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const vote = await getZavierkaVoteRef(ctx.root.id, p.votingItemId);
    if (!vote) throw validationError("votingItemId");
    return {
      title: t("Mcp.actions.approve_zavierka.title"),
      summary: t("Mcp.actions.approve_zavierka.summary", { year: String(p.year) }),
      rows: [
        { label: t("Mcp.preview.year"), value: String(p.year) },
        { label: t("Mcp.preview.voting"), value: vote.votingTitle, untrusted: true },
        { label: t("Mcp.preview.votingItem"), value: vote.itemTitle, untrusted: true },
        {
          label: t("Mcp.preview.periodStatus"),
          before: t("Mcp.preview.periodPublished"),
          after: t("Mcp.preview.periodClosed"),
        },
      ],
      consequences: [t("Mcp.consequences.zavierkaClosed")],
      warnings: [],
    };
  },
  async commit(ctx, p) {
    await approveZavierka({
      entityId: ctx.root.id,
      year: p.year,
      votingItemId: p.votingItemId,
      actorId: ctx.principal.userId,
      justification: mcpJustification(ctx),
    });
    return { data: { year: p.year }, path: "/accounting/vyuctovanie" };
  },
});

export const ACCOUNTING_ACTIONS = [
  matchPayment,
  recordPayment,
  postExpenseFromInbox,
  dismissInbox,
  submitMeterReading,
  approveZavierkaAction,
];

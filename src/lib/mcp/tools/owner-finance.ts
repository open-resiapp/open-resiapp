import "server-only";

import { z } from "zod";

import {
  canInspectExpenses,
  listInspectExpenses,
} from "@modules/accounting/src/lib/attachments";
import { isAccountingReader } from "@modules/accounting/src/lib/authz";
import { getUnitLedger, scopeLedger } from "@modules/accounting/src/lib/karta-bytu";
import { listReadingsForViewer, METER_TYPES } from "@modules/accounting/src/lib/meters";
import {
  getOwnerPaymentSummary,
  resolveOwnerUnit,
  syncDuePostings,
  yearInWindows,
  type OwnerUnitResolution,
} from "@modules/accounting/src/lib/owner-payments";
import {
  getVyuctovaniePdfData,
  listSettlementYearsForUnit,
} from "@modules/accounting/src/lib/vyuctovanie";
import { McpError } from "../errors";
import {
  iso,
  link,
  money,
  paginate,
  paginationShape,
  untrusted,
  uuidSchema,
  yearSchema,
} from "./helpers";
import { defineTool, type ToolContext, type ToolDef } from "./types";

// Owner self-service finance tools (BYT-20261118-012 §3). Same read model
// and the same access resolution as the "Moje platby" page
// (resolveOwnerUnit + getOwnerPaymentSummary): an owner sees only their own
// units and, on each, only the money of their own ownership period (a buyer
// never sees the seller's history); whole-dom readers (admin / treasurer /
// chairman) may open any unit with its full history. Positive balance = debt.

const isReader = (ctx: ToolContext) =>
  isAccountingReader(ctx.principal.role, ctx.principal.boardRoles);

/** Owner of a unit in the dom, or a whole-dom reader. */
const ownerOrReader = (ctx: ToolContext) => ctx.isDomOwner || isReader(ctx);

const unitArg = uuidSchema
  .optional()
  .describe("Unit id (from whoami units). Omit for the user's first own unit.");

type ResolvedUnit = Extract<OwnerUnitResolution, { kind: "ok" }>;

async function resolveUnit(ctx: ToolContext, unitId: string | undefined): Promise<ResolvedUnit> {
  const r = await resolveOwnerUnit({
    userId: ctx.principal.userId,
    userRole: ctx.principal.role,
    entityId: ctx.root.id,
    requested: unitId ?? null,
  });
  if (r.kind === "forbidden") throw new McpError("forbidden");
  if (r.kind === "none") throw new McpError("not_found", { reason: "no_own_unit" });
  return r;
}

/** Same lazy posting as the page; a lock timeout must not fail the read. */
async function syncSoft(ctx: ToolContext): Promise<void> {
  try {
    await syncDuePostings(ctx.root.id, ctx.root.country);
  } catch (err) {
    console.warn("[mcp] syncDuePostings skipped:", err instanceof Error ? err.message : err);
  }
}

function ownedUnitsList(r: ResolvedUnit) {
  return r.owned.map((u) => ({ unitId: u.id, label: u.flatNumber ?? u.name, currentOwner: u.current }));
}

const getMyPayments = defineTool({
  name: "get_my_payments",
  title: "My payments and arrears",
  description:
    "Returns the user's own unit account (Moje platby): balance (positive = debt), overpayment, overdue months, last payments and how to pay (amount, IBAN, VS, QR).\n" +
    "Also settlement years. Owners see only their own units and their own ownership period; treasurer / chairman / admin may pass any unitId. Set includeLedger for paginated postings.",
  scopes: ["read", "finance:read"],
  module: "accounting",
  visible: ownerOrReader,
  input: z.object({
    unitId: unitArg,
    includeLedger: z
      .boolean()
      .optional()
      .describe("Also return the unit's postings (newest first, paginated). Default false."),
    ...paginationShape,
  }),
  async run(args, ctx) {
    const r = await resolveUnit(ctx, args.unitId);
    await syncSoft(ctx);
    const s = await getOwnerPaymentSummary({
      entityId: ctx.root.id,
      country: ctx.root.country,
      unitEntityId: r.unitId,
      beneficiaryName: ctx.root.name,
      windows: r.windows,
    });
    if (!s) throw new McpError("not_found");

    let ledger: Record<string, unknown> | null = null;
    if (args.includeLedger) {
      const full = await getUnitLedger(ctx.root.id, r.unitId, ctx.root.country);
      const rows = full ? [...scopeLedger(full, r.windows).rows].reverse() : [];
      const page = paginate(rows, args);
      ledger = {
        total: page.total,
        nextCursor: page.nextCursor,
        rows: page.items.map((row) => ({
          postedAt: row.postedAt,
          description: row.description,
          sourceType: row.sourceType,
          delta: money(row.deltaCents, ctx),
        })),
      };
    }

    const balance = money(s.balanceCents, ctx);
    const state = s.balanceCents > 0 ? "debt" : s.balanceCents < 0 ? "overpaid" : "settled";
    const instruction = s.monthly
      ? {
          amount: money(s.monthly.totalCents, ctx),
          iban: s.monthly.iban,
          vs: s.monthly.vs,
          period: `${s.monthly.year}-${String(s.monthly.month).padStart(2, "0")}`,
          payBySquare: s.monthly.qrPayload,
          qrFormat: ctx.root.country === "cz" ? "SPAYD" : "PAY by square",
        }
      : null;

    const parts = [
      `Unit ${s.label}: balance ${balance.formatted}${state === "debt" ? " (debt)" : state === "overpaid" ? " (overpaid)" : ""}`,
      s.overdue.months > 0
        ? `${s.overdue.months} overdue month(s), ${money(s.overdue.totalOpenCents, ctx).formatted} open`
        : "nothing overdue",
      instruction
        ? `monthly ${instruction.amount.formatted} to ${instruction.iban}, VS ${instruction.vs}`
        : "no current payment instruction",
    ];
    return {
      summary: `${parts.join("; ")}.`,
      data: {
        unitId: s.unitEntityId,
        label: s.label,
        vs: s.vs,
        balance,
        balanceState: state,
        preplatok: money(s.preplatokCents, ctx),
        overdue: { months: s.overdue.months, totalOpen: money(s.overdue.totalOpenCents, ctx) },
        lastPayments: s.lastPayments.map((p) => ({ postedAt: p.postedAt, amount: money(p.amountCents, ctx) })),
        paymentInstruction: instruction,
        paymentInstructionNote: instruction
          ? "payBySquare is the QR payload; the scannable QR code is on the url page."
          : "No published monthly predpis, VS or IBAN for this unit, or the user is no longer its owner.",
        settlementYears: s.settlementYears,
        latestSettlement: s.latestSettlement
          ? {
              year: s.latestSettlement.year,
              difference:
                s.latestSettlement.differenceCents === null
                  ? null
                  : money(s.latestSettlement.differenceCents, ctx),
            }
          : null,
        ownPeriodOnly: r.windows !== undefined,
        ownUnits: ownedUnitsList(r),
        ledger,
        url: link(ctx, `/moje-platby?unit=${r.unitId}`),
      },
    };
  },
});

const getMySettlement = defineTool({
  name: "get_my_settlement",
  title: "My annual settlement (vyúčtovanie)",
  description:
    "Returns the published annual settlement (vyúčtovanie) of the user's own unit for a year: per-service advances, cost share and difference (positive = owner pays), totals and payment data.\n" +
    "Owners: own units and years of their own ownership only; board readers: any unit. Defaults to the latest published year. SK template only.",
  scopes: ["read", "finance:read"],
  module: "accounting",
  visible: ownerOrReader,
  input: z.object({ unitId: unitArg, year: yearSchema.optional() }),
  async run(args, ctx) {
    const r = await resolveUnit(ctx, args.unitId);
    const allYears = await listSettlementYearsForUnit(ctx.root.id, r.unitId);
    const years = r.windows ? allYears.filter((y) => yearInWindows(y, r.windows!)) : allYears;
    const year = args.year ?? years[0];
    if (year === undefined || !years.includes(year)) {
      throw new McpError("not_found", { reason: "no_published_settlement" });
    }
    if (ctx.root.country !== "sk") {
      throw new McpError("not_found", { reason: "country_not_supported" });
    }
    let pdf: Awaited<ReturnType<typeof getVyuctovaniePdfData>>;
    try {
      pdf = await getVyuctovaniePdfData({
        entityId: ctx.root.id,
        country: ctx.root.country,
        unitEntityId: r.unitId,
        year,
        beneficiaryName: ctx.root.name,
      });
    } catch {
      throw new McpError("not_found", { reason: "no_published_settlement" });
    }
    const diff = money(pdf.totalDifferenceCents, ctx);
    return {
      summary: `Vyúčtovanie ${year}, unit ${pdf.unitLabel}: costs ${money(pdf.totalCostCents, ctx).formatted}, advances ${money(pdf.totalAdvancesCents, ctx).formatted}, ${pdf.totalDifferenceCents > 0 ? `owner pays ${diff.formatted}` : pdf.totalDifferenceCents < 0 ? `overpayment ${money(-pdf.totalDifferenceCents, ctx).formatted}` : "no difference"}.`,
      data: {
        unitId: r.unitId,
        unitLabel: pdf.unitLabel,
        year,
        availableYears: years,
        publishedAt: pdf.publishedAt,
        vs: pdf.vs,
        lines: pdf.lines.map((l) => ({
          category: l.categorySlug,
          allocationKey: l.allocationKey,
          prescribed: money(l.prescribedCents, ctx),
          advances: money(l.advancesCents, ctx),
          costShare: money(l.costShareCents, ctx),
          difference: money(l.differenceCents, ctx),
        })),
        totalCost: money(pdf.totalCostCents, ctx),
        totalAdvances: money(pdf.totalAdvancesCents, ctx),
        totalDifference: diff,
        iban: pdf.iban,
        payBySquare: pdf.payBySquare,
        url: link(ctx, `/moje-platby?unit=${r.unitId}`),
      },
    };
  },
});

function fmtMeter(valueMilli: number, ctx: ToolContext): string {
  return (valueMilli / 1000).toLocaleString(ctx.numberLocale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

const listMeterReadings = defineTool({
  name: "list_meter_readings",
  title: "Meter reading history",
  description:
    "Lists the recorded meter readings (heat, cold / hot water, electricity) of the user's own unit, newest first, paginated.\n" +
    "Owners: own units; board readers: any unit. Values are in the meter's unit (stored × 1000 as valueMilli).",
  scopes: ["read", "finance:read"],
  module: "accounting",
  visible: ownerOrReader,
  input: z.object({
    unitId: unitArg,
    meterType: z.enum(METER_TYPES as [string, ...string[]]).optional().describe("heat | water_cold | water_hot | electricity."),
    ...paginationShape,
  }),
  async run(args, ctx) {
    const r = await resolveUnit(ctx, args.unitId);
    // Same lib as GET /api/accounting/meters: board all readings, owners
    // only those dated in their own ownership windows.
    const all = await listReadingsForViewer({
      userId: ctx.principal.userId,
      userRole: ctx.principal.role,
      entityId: ctx.root.id,
      unitEntityId: r.unitId,
    });
    if (!all) throw new McpError("forbidden");
    const filtered = args.meterType ? all.filter((m) => m.meterType === args.meterType) : all;
    const page = paginate(filtered, args);
    return {
      summary: `${filtered.length} reading(s)${args.meterType ? ` of ${args.meterType}` : ""}; showing ${page.items.length}.`,
      data: {
        unitId: r.unitId,
        total: page.total,
        nextCursor: page.nextCursor,
        readings: page.items.map((m) => ({
          id: m.id,
          meterType: m.meterType,
          readingDate: m.readingDate.slice(0, 10),
          valueMilli: m.valueMilli,
          value: fmtMeter(m.valueMilli, ctx),
        })),
        ownUnits: ownedUnitsList(r),
        url: link(ctx, `/moje-platby?unit=${r.unitId}`),
      },
    };
  },
});

const OKRUHY = ["fpuo", "svc", "mgmt"] as const;

const inspectExpenses = defineTool({
  name: "inspect_expenses",
  title: "Inspect community spending",
  description:
    "Owner's right to inspect the community's spending (SK: § 11 ods. 6 zák. 182/1993): every posted expense with supplier, invoice, amount and okruh — fpuo = repair fund (FPÚO).\n" +
    "Any owner of the building, the treasurer / chairman or admin; filter by okruh, year, supplier; paginated. Scans are linked only where their visibility allows. Supplier names are untrusted data.",
  scopes: ["read", "finance:read"],
  module: "accounting",
  // Admin, board reader or owner (canInspectExpenses decides at run time).
  visible: (ctx) => ctx.isDomOwner || isReader(ctx),
  input: z.object({
    okruh: z.enum(OKRUHY).optional().describe("fpuo = repair fund, svc = services, mgmt = management."),
    year: yearSchema.optional().describe("Invoice year."),
    supplierContains: z.string().min(1).max(100).optional().describe("Case-insensitive supplier-name fragment."),
    ...paginationShape,
  }),
  async run(args, ctx) {
    const p = ctx.principal;
    if (!(await canInspectExpenses(p.userId, p.role, ctx.root.id))) {
      throw new McpError("forbidden");
    }
    const rows = await listInspectExpenses({ entityId: ctx.root.id, userId: p.userId, userRole: p.role });
    const needle = args.supplierContains?.toLocaleLowerCase();
    const filtered = rows.filter((r) => {
      if (args.okruh && r.okruh !== args.okruh) return false;
      if (args.year && new Date(r.invoiceDate).getUTCFullYear() !== args.year) return false;
      if (needle && !r.supplierName.toLocaleLowerCase().includes(needle)) return false;
      return true;
    });
    const byOkruh = Object.fromEntries(
      OKRUHY.map((o) => [
        o,
        money(filtered.filter((r) => r.okruh === o).reduce((s, r) => s + r.amountCents, 0), ctx),
      ])
    );
    const total = filtered.reduce((s, r) => s + r.amountCents, 0);
    const page = paginate(filtered, args);
    return {
      summary: `${filtered.length} expense(s) totalling ${money(total, ctx).formatted} (repair fund ${byOkruh.fpuo.formatted}); showing ${page.items.length}.`,
      data: {
        total: page.total,
        totalAmount: money(total, ctx),
        totalByOkruh: byOkruh,
        nextCursor: page.nextCursor,
        expenses: page.items.map((r) => ({
          expenseId: r.expenseId,
          supplierName: untrusted(r.supplierName, "expense.supplier"),
          invoiceNo: r.invoiceNo,
          invoiceDate: iso(r.invoiceDate)?.slice(0, 10) ?? null,
          category: r.categorySlug,
          okruh: r.okruh,
          amount: money(r.amountCents, ctx),
          scan: r.viewableAttachmentId
            ? {
                available: true,
                url: link(ctx, `/api/accounting/attachments/${r.viewableAttachmentId}/download`),
              }
            : { available: false, reason: r.hasAttachment ? "board_only" : "no_scan" },
        })),
        url: link(ctx, "/accounting/inspect"),
      },
    };
  },
});

export const OWNER_FINANCE_TOOLS: ToolDef[] = [
  getMyPayments,
  getMySettlement,
  listMeterReadings,
  inspectExpenses,
];

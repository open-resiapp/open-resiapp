import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { routing } from "@/i18n/routing";
import { canReadAccounting } from "@modules/accounting/src/lib/authz";
import { canReadUnitLedger, getUnitLedger } from "@modules/accounting/src/lib/karta-bytu";
import { getTrialBalanceForYear } from "@modules/accounting/src/lib/accountant-view";
import { getFpuoReport } from "@modules/accounting/src/lib/fpuo-report";
import { listPayments } from "@modules/accounting/src/lib/payments";
import { getBoardDebtorList } from "@modules/accounting/src/lib/debtors";
import {
  parseIsoDate,
  tableToCsv,
  tableToXlsx,
  type ReportCell,
  type ReportTable,
} from "@modules/accounting/src/lib/report-format";

// Auditor reports (kontrolná komisia / audítor / účtovník): trial balance
// per year, payments in a date range, debtors, unit card, FPÚO per unit.
// GET /api/accounting/reports/{report}?format=json|csv|xlsx&locale=…
// Whole-dom reports need a board reader (treasurer / chairman / admin);
// the unit card also opens to the unit's own active owner (same rule as
// the karta screen). Every file carries a totals row.

const REPORTS = ["trial-balance", "payments", "debtors", "unit-card", "fpuo"] as const;
type Report = (typeof REPORTS)[number];
type Format = "json" | "csv" | "xlsx";

const c = (cents: number): ReportCell => ({ cents });

function pickLocale(raw: string | null): string {
  return (routing.locales as readonly string[]).includes(raw ?? "")
    ? (raw as string)
    : routing.defaultLocale;
}

function parseYear(raw: string | null): number | null {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
}

export async function handleReport(
  req: NextRequest,
  report: string
): Promise<NextResponse> {
  if (!(REPORTS as readonly string[]).includes(report)) {
    return NextResponse.json({ error: "unknown_report" }, { status: 404 });
  }
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const root = await getCommunityRoot();
  if (!root) return NextResponse.json({ error: "no community" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const format = (["json", "csv", "xlsx"].includes(sp.get("format") ?? "")
    ? sp.get("format")
    : "json") as Format;
  const locale = pickLocale(sp.get("locale"));
  const userId = session.user.id;
  const userRole = session.user.role as string;

  // Access — before any data read.
  const unitId = sp.get("unit");
  const allowed =
    report === "unit-card"
      ? !!unitId && (await canReadUnitLedger(userId, userRole, root.id, unitId))
      : await canReadAccounting(userId, userRole, root.id);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { getTranslations, getFormatter } = await import("next-intl/server");
  const t = await getTranslations({ locale, namespace: "Accounting.reports" });
  const fmt = await getFormatter({ locale });
  const date = (iso: string) =>
    fmt.dateTime(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const generated = t("generatedAt", { date: date(new Date().toISOString()) });

  let table: ReportTable;
  let json: unknown;

  switch (report as Report) {
    case "trial-balance": {
      const year = parseYear(sp.get("year")) ?? new Date().getUTCFullYear();
      const tb = await getTrialBalanceForYear(root.id, root.country, year);
      json = tb;
      const dr = (v: number) => (v > 0 ? c(v) : null);
      const cr = (v: number) => (v < 0 ? c(-v) : null);
      table = {
        name: t("tb.sheet", { year }),
        caption: [root.name, t("tb.title", { year }), generated],
        headers: [
          t("tb.colCode"),
          t("tb.colName"),
          t("tb.colOpeningDr"),
          t("tb.colOpeningCr"),
          t("tb.colTurnoverDr"),
          t("tb.colTurnoverCr"),
          t("tb.colClosingDr"),
          t("tb.colClosingCr"),
        ],
        rows: tb.rows.map((r) => [
          r.code,
          r.name,
          dr(r.openingCents),
          cr(r.openingCents),
          c(r.debitCents),
          c(r.creditCents),
          dr(r.closingCents),
          cr(r.closingCents),
        ]),
        totals: [
          t("total"),
          "",
          c(tb.totals.openingDebitCents),
          c(tb.totals.openingCreditCents),
          c(tb.totals.debitCents),
          c(tb.totals.creditCents),
          c(tb.totals.closingDebitCents),
          c(tb.totals.closingCreditCents),
        ],
        notes: [t("tb.note")],
      };
      break;
    }
    case "fpuo": {
      const year = parseYear(sp.get("year")) ?? new Date().getUTCFullYear();
      const r = await getFpuoReport(root.id, root.country, year);
      json = r;
      table = {
        name: t("fpuo.sheet", { year }),
        caption: [root.name, t("fpuo.title", { year }), generated],
        headers: [
          t("fpuo.colUnit"),
          t("fpuo.colOpening"),
          t("fpuo.colPredpis"),
          t("fpuo.colPaid"),
          t("fpuo.colUses"),
          t("fpuo.colIncome"),
          t("fpuo.colOther"),
          t("fpuo.colClosing"),
        ],
        rows: r.rows.map((u) => [
          u.shareMissing ? `${u.unitLabel} (${t("fpuo.shareMissing")})` : u.unitLabel,
          c(u.openingCents),
          c(u.predpisCents),
          c(u.paidCents),
          c(u.usesCents),
          c(u.incomeCents),
          c(u.otherCents),
          c(u.closingCents),
        ]),
        totals: [
          t("total"),
          c(r.totals.openingCents),
          c(r.totals.predpisCents),
          c(r.totals.paidCents),
          c(r.totals.usesCents),
          c(r.totals.incomeCents),
          c(r.totals.otherCents),
          c(r.totals.closingCents),
        ],
        notes: [
          t("fpuo.note"),
          t("fpuo.reconcile", {
            ledger: fmt.number(r.ledgerClosingCents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            difference: fmt.number(r.differenceCents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          }),
          ...(r.unallocatedCents !== 0
            ? [
                t("fpuo.unallocated", {
                  amount: fmt.number(r.unallocatedCents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                }),
              ]
            : []),
        ],
      };
      break;
    }
    case "payments": {
      const from = parseIsoDate(sp.get("from"));
      const to = parseIsoDate(sp.get("to"));
      const list = await listPayments(root.id, { from, to, pageSize: null });
      json = list;
      const tSource = await getTranslations({ locale, namespace: "Accounting.payments" });
      table = {
        name: t("payments.sheet"),
        caption: [
          root.name,
          t("payments.title", {
            from: from ? date(from) : "—",
            to: to ? date(to) : "—",
          }),
          generated,
        ],
        headers: [
          t("payments.colDate"),
          t("payments.colUnit"),
          t("payments.colVs"),
          t("payments.colAmount"),
          t("payments.colAllocated"),
          t("payments.colCredit"),
          t("payments.colSource"),
          t("payments.colNote"),
        ],
        rows: list.rows.map((p) => {
          const voided = !!p.voidedAt;
          return [
            date(p.receivedAt),
            p.unitFlatNumber ?? p.unitName ?? "",
            p.vs ?? "",
            c(p.amountCents),
            voided ? null : c(p.allocatedCents),
            voided ? null : c(p.amountCents - p.allocatedCents),
            tSource(`source_${p.source}`),
            voided
              ? `${t("payments.voided")}: ${p.voidReason ?? ""}`
              : p.narrative ?? "",
          ];
        }),
        totals: [
          t("totalExclVoided", { count: list.total - list.totals.voidedCount }),
          "",
          "",
          c(list.totals.amountCents),
          c(list.totals.allocatedCents),
          c(list.totals.unallocatedCents),
          "",
          "",
        ],
      };
      break;
    }
    case "debtors": {
      // Board view (names, every unit with a net debt) — same figure as
      // the karta balance (311 + 379 net), so the two always agree.
      const list = await getBoardDebtorList(root.id, root.country);
      json = list;
      table = {
        name: t("debtors.sheet"),
        caption: [root.name, t("debtors.title"), generated],
        headers: [t("debtors.colUnit"), t("debtors.colOwners"), t("debtors.colBalance")],
        rows: list.debtors.map((d) => [
          d.unitLabel,
          (d.ownerNames ?? []).join(", "),
          c(d.balanceCents),
        ]),
        totals: [
          t("totalCount", { count: list.debtors.length }),
          "",
          c(list.debtors.reduce((s, d) => s + d.balanceCents, 0)),
        ],
      };
      break;
    }
    case "unit-card": {
      const ledger = await getUnitLedger(root.id, unitId!, root.country);
      if (!ledger) return NextResponse.json({ error: "not found" }, { status: 404 });
      json = ledger;
      let predpis = 0;
      let paid = 0;
      table = {
        name: t("card.sheet", { unit: ledger.flatNumber ?? ledger.name }),
        caption: [
          root.name,
          t("card.title", { unit: ledger.flatNumber ?? ledger.name }),
          ledger.vs ? t("card.vs", { vs: ledger.vs }) : "",
          generated,
        ],
        headers: [
          t("card.colDate"),
          t("card.colDescription"),
          t("card.colPredpis"),
          t("card.colPaid"),
          t("card.colBalance"),
        ],
        rows: ledger.rows.map((r) => {
          const isPayment = r.sourceType === "payment";
          if (isPayment) paid += -r.deltaCents;
          else predpis += r.deltaCents;
          return [
            date(r.postedAt),
            r.description,
            !isPayment && r.deltaCents !== 0 ? c(r.deltaCents) : null,
            isPayment && r.deltaCents !== 0 ? c(-r.deltaCents) : null,
            c(r.balanceCents),
          ];
        }),
        totals: [t("total"), "", c(predpis), c(paid), c(ledger.balanceCents)],
        notes: [
          ledger.balanceCents > 0
            ? t("card.noteOwes")
            : ledger.balanceCents < 0
              ? t("card.noteCredit")
              : t("card.noteSettled"),
        ],
      };
      break;
    }
  }

  if (format === "json") return NextResponse.json(json);

  const stem = `${report}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "csv") {
    return new NextResponse(tableToCsv(table, locale), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const buf = tableToXlsx(table);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

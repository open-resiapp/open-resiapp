// Report table → CSV / XLSX (auditor exports). PURE — no DB, no next/*.
// Every export carries a header row, data rows and a TOTALS row, so the
// file reconciles on its own (an auditor re-adds the columns and ticks).
//
// Amounts travel as integer cents and are written as euros: XLSX gets real
// numeric cells (format #,##0.00) so the sheet can sum them; CSV uses the
// locale's decimal separator and ";" (what Excel expects in sk/cs). Text
// cells pass spreadsheetSafe (formula-injection guard). xlsx@0.18.5 is used
// WRITE-only (its advisories are in the parser — decision 2026-11-18).

import * as XLSX from "xlsx";
import { spreadsheetSafe } from "./reading-rounds-format";

/** A cell: text, plain number, or an amount in cents ({ cents }). */
export type ReportCell = string | number | null | { cents: number };

export interface ReportTable {
  /** Sheet name (≤ 31 chars) and file stem. */
  name: string;
  /** Optional caption lines above the header (dom, period, generated at). */
  caption?: string[];
  headers: string[];
  rows: ReportCell[][];
  /** Totals row — required for every auditor export. */
  totals: ReportCell[];
  /** Optional note lines below the totals (reconciliation, legend). */
  notes?: string[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" that is a real calendar date, else null. */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw || !ISO_DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw
    ? null
    : raw;
}

function centsToCsv(cents: number, decimalComma: boolean): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const s = `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return decimalComma ? s.replace(".", ",") : s;
}

function csvField(value: string, sep: string): string {
  return /["\r\n]/.test(value) || value.includes(sep)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function cellToCsv(cell: ReportCell, decimalComma: boolean): string {
  if (cell === null) return "";
  if (typeof cell === "object") return centsToCsv(cell.cents, decimalComma);
  if (typeof cell === "number") {
    const s = String(cell);
    return decimalComma ? s.replace(".", ",") : s;
  }
  return spreadsheetSafe(cell);
}

/** CSV with UTF-8 BOM (Excel opens diacritics correctly). */
export function tableToCsv(table: ReportTable, locale: string): string {
  const decimalComma = locale !== "en";
  const sep = decimalComma ? ";" : ",";
  const line = (cells: string[]) => cells.map((c) => csvField(c, sep)).join(sep);
  const out: string[] = [];
  for (const c of table.caption ?? []) out.push(line([spreadsheetSafe(c)]));
  if (table.caption?.length) out.push("");
  out.push(line(table.headers.map((h) => spreadsheetSafe(h))));
  for (const row of table.rows) out.push(line(row.map((c) => cellToCsv(c, decimalComma))));
  out.push(line(table.totals.map((c) => cellToCsv(c, decimalComma))));
  if (table.notes?.length) {
    out.push("");
    for (const n of table.notes) out.push(line([spreadsheetSafe(n)]));
  }
  return "﻿" + out.join("\r\n") + "\r\n";
}

/** XLSX workbook (one sheet) as a Node Buffer. */
export function tableToXlsx(table: ReportTable): Buffer {
  const aoa: (string | number | null)[][] = [];
  const moneyCells: { r: number; c: number }[] = [];
  const pushRow = (cells: ReportCell[]) => {
    const r = aoa.length;
    aoa.push(
      cells.map((cell, c) => {
        if (cell === null) return null;
        if (typeof cell === "object") {
          moneyCells.push({ r, c });
          return cell.cents / 100;
        }
        return typeof cell === "string" ? spreadsheetSafe(cell) : cell;
      })
    );
  };
  for (const c of table.caption ?? []) aoa.push([spreadsheetSafe(c)]);
  if (table.caption?.length) aoa.push([]);
  aoa.push(table.headers.map((h) => spreadsheetSafe(h)));
  for (const row of table.rows) pushRow(row);
  pushRow(table.totals);
  if (table.notes?.length) {
    aoa.push([]);
    for (const n of table.notes) aoa.push([spreadsheetSafe(n)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const { r, c } of moneyCells) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = "#,##0.00";
  }
  ws["!cols"] = table.headers.map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, table.name.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

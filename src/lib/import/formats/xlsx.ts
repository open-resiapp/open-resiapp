import * as XLSX from "xlsx";

import { columnsForStructure, sampleRow } from "../columns";
import type { StructureVariant } from "../types";

/**
 * Build an XLSX template as a `Uint8Array` ready for `Response`.
 *
 * Trade-off note: the open-source `xlsx` build does not write data-validation
 * dropdowns or per-cell comments via its high-level API. We still set:
 *   - column widths
 *   - number-format `@` on share columns (so Excel won't auto-convert 1/96 to a date)
 *   - frozen header row
 * Inline comments + dropdowns can be added later by switching to ExcelJS
 * if customers ask. The text-format hint already covers the worst Excel
 * footgun (date auto-conversion of fractions).
 */
export function generateXlsxTemplate(structure: StructureVariant): Uint8Array {
  const cols = columnsForStructure(structure);
  const headers = cols.map((c) => c.label);
  const sample = sampleRow(structure);
  const sampleArr = cols.map((c) => sample[c.key] ?? "");

  const aoa: (string | number)[][] = [headers, sampleArr];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Freeze header row.
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  // Column widths + per-column number format for share columns.
  ws["!cols"] = cols.map((c) => {
    const wch =
      c.key.includes("address") || c.key.includes("name")
        ? 28
        : c.key.includes("email")
        ? 24
        : 14;
    return { wch };
  });

  // Force share columns to text format so Excel doesn't reinterpret 1/96 etc.
  cols.forEach((c, idx) => {
    if (c.excelFormat !== "text") return;
    const colLetter = XLSX.utils.encode_col(idx);
    // Apply to a generous range so admin can paste plenty of rows.
    for (let r = 1; r < 1000; r++) {
      const ref = `${colLetter}${r + 1}`;
      const cell = ws[ref];
      if (!cell) continue;
      cell.z = "@";
      cell.t = "s";
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Import");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buffer);
}

/**
 * Parse an XLSX file (as ArrayBuffer / Uint8Array) into raw row objects keyed
 * by column label. Returns the first worksheet's rows.
 */
export function parseXlsx(buffer: ArrayBuffer | Uint8Array): Record<string, string>[] {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    defval: "",
    raw: false, // get formatted strings, so '1/96' stays '1/96'
  });
}

/** Detect XLSX file by magic bytes (`PK\x03\x04` = ZIP signature). */
export function looksLikeXlsx(buffer: Uint8Array): boolean {
  return (
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

import Papa from "papaparse";

import { columnsForStructure, sampleRow } from "../columns";
import type { StructureVariant } from "../types";

/**
 * Generate a CSV string for the chosen structure. If `dataRows` is omitted
 * a one-row sample template is produced (used by the wizard's template-
 * download). When `dataRows` is provided, those rows are serialised — this
 * is how Easy Import's reverse (export current state) writes CSV.
 */
export function generateCsvTemplate(
  structure: StructureVariant,
  dataRows?: Array<Record<string, string | number | undefined>>
): string {
  const cols = columnsForStructure(structure);
  const headers = cols.map((c) => c.label);
  const data: (string | number)[][] =
    dataRows && dataRows.length > 0
      ? dataRows.map((r) =>
          cols.map((c) => {
            const v = r[c.key];
            if (v === undefined || v === null) return "";
            return typeof v === "number" ? v : String(v);
          })
        )
      : [cols.map((c) => sampleRow(structure)[c.key] ?? "")];
  // Slovak Excel default delimiter is `;`. UTF-8 BOM keeps diacritics intact
  // when opened in Excel on Windows.
  const csv = Papa.unparse(
    { fields: headers, data },
    { delimiter: ";", header: true }
  );
  return "﻿" + csv;
}

/**
 * Parse a CSV file (as text) into raw row objects keyed by column label.
 * Returns a list of `Record<string, string>` — the validator handles type
 * coercion. Auto-detects delimiter via papaparse.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Strip BOM if present.
  const cleaned = text.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    delimiter: "", // auto-detect: ',', ';', '\t'
  });
  return result.data;
}

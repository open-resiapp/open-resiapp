import Papa from "papaparse";

import { columnsForStructure, sampleRow } from "../columns";
import type { StructureVariant } from "../types";

/** Generate a CSV template string for the chosen structure. */
export function generateCsvTemplate(structure: StructureVariant): string {
  const cols = columnsForStructure(structure);
  const headers = cols.map((c) => c.label);
  const sample = sampleRow(structure);
  const sampleArr = cols.map((c) => sample[c.key] ?? "");
  // Slovak Excel default delimiter is `;`. UTF-8 BOM keeps diacritics intact
  // when opened in Excel on Windows.
  const csv = Papa.unparse(
    {
      fields: headers,
      data: [sampleArr],
    },
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

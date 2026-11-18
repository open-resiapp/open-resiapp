import "server-only";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { meterReadings } from "../db/schema";
import { getBoardRoundData } from "./reading-rounds";
import { spreadsheetSafe } from "./reading-rounds-format";

// CSV / XLSX export of a reading round (BYT-20261118-006). Board readers
// and writers. Three tables: persons (unit × 12 months + total), unit
// meter readings, building meter readings. Every text cell goes through
// spreadsheetSafe (formula injection). xlsx@0.18.5 is used WRITE-only —
// its known advisories are in the parser (decision 2026-11-18).
//
// Headers are stable machine-ish column names (not translated): the file
// is a data hand-off for the board's spreadsheet, same as the JSON export.

export type ExportPart = "persons" | "meters" | "building";

type Cell = string | number;

async function buildTables(
  entityId: string,
  year: number
): Promise<Record<ExportPart, Cell[][]>> {
  const data = await getBoardRoundData(entityId, year);
  const label = new Map(data.units.map((u) => [u.unitEntityId, u]));

  const persons: Cell[][] = [
    ["unit", "vs", ...Array.from({ length: 12 }, (_, i) => `m${i + 1}`), "person_months_total"],
  ];
  for (const u of data.units) {
    if (!u.persons) continue;
    persons.push([
      spreadsheetSafe(u.label),
      spreadsheetSafe(u.vs ?? ""),
      ...u.persons.months.map((m) => (m === null ? "" : m)),
      u.persons.total,
    ]);
  }

  const meters: Cell[][] = [
    ["unit", "vs", "type", "reading_date", "value", "late", "resolved", "submitted_by", "submitted_at", "note"],
  ];
  if (data.round) {
    // Submitter names: one query over the round's non-voided rows.
    const rows = await db
      .select({
        unitEntityId: meterReadings.unitEntityId,
        meterType: meterReadings.meterType,
        readingDate: meterReadings.readingDate,
        valueMilli: meterReadings.valueMilli,
        late: meterReadings.late,
        resolvedAt: meterReadings.resolvedAt,
        createdById: meterReadings.createdById,
        createdAt: meterReadings.createdAt,
        note: meterReadings.note,
      })
      .from(meterReadings)
      .where(and(eq(meterReadings.roundId, data.round.id), isNull(meterReadings.voidedAt)))
      .orderBy(asc(meterReadings.unitEntityId), asc(meterReadings.meterType));
    const userIds = [...new Set(rows.map((r) => r.createdById))];
    const names = new Map(
      userIds.length
        ? (
            await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, userIds))
          ).map((u) => [u.id, u.name])
        : []
    );
    for (const r of rows) {
      const u = label.get(r.unitEntityId);
      meters.push([
        spreadsheetSafe(u?.label ?? r.unitEntityId),
        spreadsheetSafe(u?.vs ?? ""),
        r.meterType,
        r.readingDate.toISOString().slice(0, 10),
        r.valueMilli / 1000,
        r.late ? "yes" : "no",
        r.resolvedAt ? "yes" : "no",
        spreadsheetSafe(names.get(r.createdById) ?? ""),
        r.createdAt.toISOString(),
        spreadsheetSafe(r.note ?? ""),
      ]);
    }
  }

  const building: Cell[][] = [["label", "type", "reading_date", "value", "note"]];
  for (const b of data.building) {
    building.push([
      spreadsheetSafe(b.label),
      b.meterType,
      b.readingDate.slice(0, 10),
      b.value / 1000,
      spreadsheetSafe(b.note ?? ""),
    ]);
  }

  return { persons, meters, building };
}

export async function buildRoundCsv(
  entityId: string,
  year: number,
  part: ExportPart
): Promise<string> {
  const tables = await buildTables(entityId, year);
  // BOM so Excel opens UTF-8 (Slovak diacritics) correctly.
  return "﻿" + Papa.unparse(tables[part], { delimiter: ";" });
}

export async function buildRoundXlsx(entityId: string, year: number): Promise<Buffer> {
  const tables = await buildTables(entityId, year);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tables.persons), "persons");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tables.meters), "meters");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tables.building), "building");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Pure revízie helpers — NO server imports (golden scripts + client can
// import this directly). Status math + iCalendar rendering only; the DB
// query lives in revisions.ts.

export type RevisionStatus = "overdue" | "due_soon" | "ok";

export interface RevisionRow {
  categorySlug: string;
  supplierName: string;
  lastInspectionDate: string;
  nextDueAt: string;
  daysUntilDue: number;
  status: RevisionStatus;
}

export const SOON_DAYS = 60;
const DAY_MS = 24 * 3600 * 1000;

export function statusFor(daysUntilDue: number): RevisionStatus {
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= SOON_DAYS) return "due_soon";
  return "ok";
}

export function daysUntil(dueIso: string, now: Date): number {
  return Math.floor(
    (new Date(dueIso).getTime() - now.getTime()) / DAY_MS
  );
}

/** Escapes a value for an iCalendar text property (RFC 5545). */
function icsEscape(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function icsDate(iso: string): string {
  // All-day VALUE=DATE — YYYYMMDD.
  return iso.slice(0, 10).replace(/-/g, "");
}

/**
 * iCalendar feed of upcoming inspection deadlines — one all-day VEVENT per
 * category. `label` maps a slug to its localized display name. Pure and
 * deterministic (no Date.now / random).
 */
export function buildRevisionsIcs(
  rows: RevisionRow[],
  buildingName: string,
  label: (slug: string) => string
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenResiApp//Accounting Revisions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const r of rows) {
    const stamp = icsDate(r.nextDueAt);
    lines.push(
      "BEGIN:VEVENT",
      // Stable UID from category + due date — re-imports update, not dupe.
      `UID:revizia-${r.categorySlug}-${stamp}@open-resiapp`,
      `DTSTART;VALUE=DATE:${stamp}`,
      `SUMMARY:${icsEscape(`${label(r.categorySlug)} — ${buildingName}`)}`,
      `DESCRIPTION:${icsEscape(
        `Termín ďalšej revízie. Posledná: ${r.lastInspectionDate.slice(0, 10)}, dodávateľ ${r.supplierName}.`
      )}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}

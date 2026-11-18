import "server-only";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { principalFromSession } from "@/lib/mcp/principal";
import { routing } from "@/i18n/routing";
import { timeZoneForCountry } from "@/lib/time-zone";
import {
  MeetingError,
  canManageAttendance,
  getAttendanceExport,
  loadMeetingVoting,
} from "@modules/voting/src/attendance";
import { isVotingVisible } from "@modules/voting/src/votings";
import { EXPORT_COLUMNS, type ExportDocument, type ExportRowMode } from "@modules/voting/src/workflow/attendance";

// BYT-20261118-001 §7 — attendance export. Rows come from ONE server
// function (buildAttendanceExport); this route renders them as .xlsx or
// returns them as JSON for the browser PDF renderer — same rows, same
// totals. Generated on request, streamed, never stored. Columns: name,
// unit, share, state, times — no e-mail / phone / address. No statutory
// citation (legal content rule, spec L4/L6).

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const principal = await principalFromSession(session);
  if (!(await isVotingVisible(principal, id))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!canManageAttendance(principal, await loadMeetingVoting(id))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const sp = new URL(request.url).searchParams;
  const document: ExportDocument = sp.get("doc") === "blank" ? "blank" : "filled";
  const mode: ExportRowMode = sp.get("mode") === "unit" ? "unit" : "owner";
  const format = sp.get("format") === "json" ? "json" : "xlsx";
  // "Len byty" — rows without non-residential units / garages (totals unchanged).
  const residentialOnly = sp.get("units") === "residential";
  const localeParam = sp.get("locale");
  const locale =
    localeParam && (routing.locales as readonly string[]).includes(localeParam)
      ? localeParam
      : routing.defaultLocale;

  let data: Awaited<ReturnType<typeof getAttendanceExport>>;
  try {
    data = await getAttendanceExport(id, document, mode, { residentialOnly });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (format === "json") {
    return NextResponse.json({ ...data, columns: EXPORT_COLUMNS[document] });
  }

  const t = await getTranslations({ locale, namespace: "MeetingAttendance.export" });
  const tRoot = await getTranslations({ locale });
  const tz = timeZoneForCountry(data.voting.country);
  const time = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz })
      : "";
  const columns = EXPORT_COLUMNS[document];
  const header = columns.map((c) => t(`columns.${c}`));
  const body = data.rows.map((r) =>
    columns.map((c) => {
      switch (c) {
        case "unit":
          return r.unit;
        case "owner":
          return r.owner;
        case "share":
          return r.sharePct;
        case "state":
          return t(`states.${r.state}`);
        case "representedBy":
          return r.representedBy ?? "";
        case "arrivedAt":
          return time(r.arrivedAt);
        case "leftAt":
          return time(r.leftAt);
        case "signature":
          return "";
      }
    })
  );
  const totals =
    document === "filled"
      ? [
          [],
          [
            t("totals", {
              present: data.totals.presentOwners,
              represented: data.totals.representedOwners,
              eligible: data.totals.eligibleOwners,
              share: data.totals.presentSharePct,
            }),
          ],
        ]
      : [[], [t("totalsBlank", { eligible: data.totals.eligibleOwners })]];

  const aoa = [[data.voting.title], [], header, ...body, ...totals];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c === "owner" || c === "signature" ? 32 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tRoot(document === "blank" ? data.headingKeys.blank : data.headingKeys.filled).slice(0, 31));
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const filename = `${document === "blank" ? "harok-na-podpis" : "prezencna-listina"}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

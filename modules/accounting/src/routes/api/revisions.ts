import { NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import {
  buildRevisionsIcs,
  listRevisions,
} from "@modules/accounting/src/lib/revisions";

// Revízie API — board roles (reader). The .ics feed carries localized
// category labels resolved from the request's messages.

export async function handleList(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const rows = await listRevisions(ctx.root.id, ctx.root.country);
  return NextResponse.json({ revisions: rows });
}

/** GET .../revisions/ics — calendar of upcoming deadlines. */
export async function handleIcs(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const rows = await listRevisions(ctx.root.id, ctx.root.country);

  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations({
    locale: "sk",
    namespace: "Accounting.serviceCategories",
  });
  const label = (slug: string) => {
    try {
      return t(slug as Parameters<typeof t>[0]);
    } catch {
      return slug;
    }
  };

  const ics = buildRevisionsIcs(rows, ctx.root.name, label);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="revizie.ics"',
    },
  });
}

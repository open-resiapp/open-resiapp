import { NextResponse } from "next/server";

import { listTemplateSummaries, getTemplate } from "@/lib/templates/loader";

// BYT-20260515-001 Phase 4: templates listing endpoint.
//
// GET /api/templates           — summary list, used by setup wizards
//                                 and the cloud customer-portal picker.
// GET /api/templates?slug=hoa  — full template (root_kind, starter_tree,
//                                 import_levels, …). Server-side seed
//                                 flows read this when bootstrapping.
//
// Auth: deliberately public read. Template metadata is not sensitive —
// it ships in the OSS repo, every cloud tenant sees the same list. If
// custom-kinds-per-instance arrives in Phase 8+ this endpoint will need
// to scope by instance.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");

  if (slug) {
    const tpl = await getTemplate(slug);
    if (!tpl) {
      return NextResponse.json(
        { error: "template_not_found", slug },
        { status: 404 }
      );
    }
    return NextResponse.json(tpl);
  }

  const summaries = await listTemplateSummaries();
  return NextResponse.json({ templates: summaries });
}

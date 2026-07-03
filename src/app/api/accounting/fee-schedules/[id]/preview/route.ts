// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handlePreview } from "@modules/accounting/src/routes/api/fee-schedule-publish";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handlePreview(req, (await ctx.params).id)
);

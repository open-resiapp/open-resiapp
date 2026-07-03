// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handlePublish } from "@modules/accounting/src/routes/api/fee-schedule-publish";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handlePublish(req, (await ctx.params).id)
);

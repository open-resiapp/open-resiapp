// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleUpomienkaPdfData } from "@modules/accounting/src/routes/api/karta-bytu";

type Ctx = { params: Promise<{ unitId: string }> };

export const GET = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) =>
    handleUpomienkaPdfData(req, (await ctx.params).unitId)
);

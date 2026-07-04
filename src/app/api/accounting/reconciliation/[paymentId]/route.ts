// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleConfirmMatch } from "@modules/accounting/src/routes/api/bank-import";

type Ctx = { params: Promise<{ paymentId: string }> };

export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) =>
    handleConfirmMatch(req, (await ctx.params).paymentId)
);

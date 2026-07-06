// Owned by the accounting module — BYT-20260512-002 (AC 479).
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleDismiss } from "@modules/accounting/src/routes/api/expense-inbox";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleDismiss(req, (await ctx.params).id)
);

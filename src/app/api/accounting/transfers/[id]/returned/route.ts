// Owned by the accounting module — BYT-20260512-002 (AC 417, metadata only).
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleMarkReturned } from "@modules/accounting/src/routes/api/okruh-transfers";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleMarkReturned(req, (await ctx.params).id)
);

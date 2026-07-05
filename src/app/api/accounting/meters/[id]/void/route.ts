// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleVoid } from "@modules/accounting/src/routes/api/meters";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleVoid(req, (await ctx.params).id)
);

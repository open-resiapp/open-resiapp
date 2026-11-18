// Owned by the accounting module — BYT-20261118-006 (reading rounds).
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleGet, handlePost } from "@modules/accounting/src/routes/api/readings";

type Ctx = { params: Promise<{ path?: string[] }> };

export const GET = withModuleEnabled("accounting", async (req: NextRequest, ctx: Ctx) =>
  handleGet(req, (await ctx.params).path ?? [])
);
export const POST = withModuleEnabled("accounting", async (req: NextRequest, ctx: Ctx) =>
  handlePost(req, (await ctx.params).path ?? [])
);

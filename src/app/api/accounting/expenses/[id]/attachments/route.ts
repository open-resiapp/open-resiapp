// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleUpload, handleListForExpense } from "@modules/accounting/src/routes/api/attachments";

type Ctx = { params: Promise<{ id: string }> };
export const POST = withModuleEnabled("accounting", async (req: NextRequest, ctx: Ctx) => handleUpload(req, (await ctx.params).id));
export const GET = withModuleEnabled("accounting", async (req: NextRequest, ctx: Ctx) => handleListForExpense(req, (await ctx.params).id));

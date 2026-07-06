// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleSetVisibility } from "@modules/accounting/src/routes/api/attachments";

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = withModuleEnabled("accounting", async (req: NextRequest, ctx: Ctx) => handleSetVisibility(req, (await ctx.params).id));

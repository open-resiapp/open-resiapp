// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleGetOne,
  handleUpdate,
  handleDiscard,
} from "@modules/accounting/src/routes/api/fee-schedules";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleGetOne(req, (await ctx.params).id)
);
export const PATCH = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleUpdate(req, (await ctx.params).id)
);
export const DELETE = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) => handleDiscard(req, (await ctx.params).id)
);

// Owned by the accounting module — auditor reports (JSON / CSV / XLSX).
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleReport } from "@modules/accounting/src/routes/api/reports";

type Ctx = { params: Promise<{ report: string }> };

export const GET = withModuleEnabled(
  "accounting",
  async (req: NextRequest, ctx: Ctx) =>
    handleReport(req, (await ctx.params).report)
);

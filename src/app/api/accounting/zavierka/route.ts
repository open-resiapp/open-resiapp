// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleGet,
  handleApprove,
} from "@modules/accounting/src/routes/api/zavierka";

export const GET = withModuleEnabled(
  "accounting",
  async (req: NextRequest) => handleGet(req)
);
export const POST = withModuleEnabled(
  "accounting",
  async (req: NextRequest) => handleApprove(req)
);

// Owned by the accounting module — BYT-20260512-002.
import { NextRequest } from "next/server";
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleVotingImpacts } from "@modules/accounting/src/routes/api/voting-impacts";

export const GET = withModuleEnabled("accounting", (req: NextRequest) =>
  handleVotingImpacts(req)
);

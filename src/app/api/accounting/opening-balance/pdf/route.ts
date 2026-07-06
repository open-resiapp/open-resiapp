// Owned by the accounting module — BYT-20260512-002 (AC 508).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handlePost } from "@modules/accounting/src/routes/api/opening-balance-pdf";

export const POST = withModuleEnabled("accounting", handlePost);

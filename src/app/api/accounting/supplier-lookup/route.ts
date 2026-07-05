// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleGet } from "@modules/accounting/src/routes/api/supplier-lookup";

export const GET = withModuleEnabled("accounting", handleGet);

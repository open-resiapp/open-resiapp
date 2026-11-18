// Owned by the accounting module — BYT-20261118-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleConnect } from "@modules/accounting/src/routes/api/enable-banking";

export const POST = withModuleEnabled("accounting", handleConnect);

// Owned by the accounting module — BYT-20261118-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleDisconnect,
  handleGet,
} from "@modules/accounting/src/routes/api/enable-banking";

export const GET = withModuleEnabled("accounting", handleGet);
export const DELETE = withModuleEnabled("accounting", handleDisconnect);

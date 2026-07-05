// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleGet,
  handlePublish,
} from "@modules/accounting/src/routes/api/vyuctovanie";

export const GET = withModuleEnabled("accounting", handleGet);
export const POST = withModuleEnabled("accounting", handlePublish);

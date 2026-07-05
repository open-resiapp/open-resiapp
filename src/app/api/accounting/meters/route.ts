// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleGet,
  handlePost,
} from "@modules/accounting/src/routes/api/meters";

export const GET = withModuleEnabled("accounting", handleGet);
export const POST = withModuleEnabled("accounting", handlePost);

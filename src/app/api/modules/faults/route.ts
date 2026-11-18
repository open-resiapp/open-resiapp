// Owned by the faults module — BYT-20261118-004.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleCreate } from "@modules/faults/src/routes/api/faults";

export const POST = withModuleEnabled("faults", handleCreate);

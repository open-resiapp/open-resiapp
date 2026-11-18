// Owned by the voting module — BYT-20261118-001 (attendance export).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet } from "@modules/voting/src/routes/api/meeting/export";

export const GET = withModuleEnabled("voting", moduleGet);

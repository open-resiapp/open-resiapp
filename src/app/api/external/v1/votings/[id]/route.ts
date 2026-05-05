// Owned by the voting module — RES-20260505-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet } from "@modules/voting/src/routes/api/external/votings/id";

export const GET = withModuleEnabled("voting", moduleGet);

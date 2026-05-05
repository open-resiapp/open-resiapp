// Owned by the voting module — RES-20260505-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet, PATCH as modulePatch } from "@modules/voting/src/routes/api/votings/id";

export const GET = withModuleEnabled("voting", moduleGet);
export const PATCH = withModuleEnabled("voting", modulePatch);

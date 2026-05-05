// Owned by the voting module — RES-20260505-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet, POST as modulePost } from "@modules/voting/src/routes/api/mandates";

export const GET = withModuleEnabled("voting", moduleGet);
export const POST = withModuleEnabled("voting", modulePost);

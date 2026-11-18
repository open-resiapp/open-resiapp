// Owned by the voting module — BYT-20261118-001 (owners' meeting).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet, POST as modulePost } from "@modules/voting/src/routes/api/meeting/meeting";

export const GET = withModuleEnabled("voting", moduleGet);
export const POST = withModuleEnabled("voting", modulePost);

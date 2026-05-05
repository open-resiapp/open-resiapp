// Owned by the voting module — RES-20260505-001.
// Wrapped by withModuleEnabled so a tenant that has disabled voting
// (core_modules.status != 'enabled') gets a 404 instead of a working
// endpoint that writes orphaned rows.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { GET as moduleGet, POST as modulePost } from "@modules/voting/src/routes/api/votings";

export const GET = withModuleEnabled("voting", moduleGet);
export const POST = withModuleEnabled("voting", modulePost);

// Owned by the voting module — BYT-20260609-008 (multi-item ballots).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  GET as moduleGet,
  POST as modulePost,
  DELETE as moduleDelete,
} from "@modules/voting/src/routes/api/ballots";

export const GET = withModuleEnabled("voting", moduleGet);
export const POST = withModuleEnabled("voting", modulePost);
export const DELETE = withModuleEnabled("voting", moduleDelete);

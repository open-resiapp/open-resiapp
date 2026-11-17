// Owned by the voting module — BYT-20261117-002 Phase 6 (confirmed e-vote).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { POST as modulePost } from "@modules/voting/src/routes/api/ballots/email-confirmation";

export const POST = withModuleEnabled("voting", modulePost);

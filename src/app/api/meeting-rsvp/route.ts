// Owned by the voting module — BYT-20261118-001 §3. Public: the signed
// meeting-rsvp token is the only authority; POST only (no write on GET).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { POST as modulePost } from "@modules/voting/src/routes/api/meeting/rsvp-token";

export const POST = withModuleEnabled("voting", modulePost);

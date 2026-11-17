import { sessionIsBoard } from "@/lib/mcp/authz";

import BoardClient from "./BoardClient";

// Board (nástenka). "New post" follows the same authority as POST /api/posts
// (createPost → assertBoard with caretaker): admin, active chairman or
// caretaker (BYT-20261117-001 Decided 1) — resolved server-side so a
// chairman without flat admin sees the button on first paint.
export default async function BoardPage() {
  const canCreate = await sessionIsBoard({ allowCaretaker: true });
  return <BoardClient canCreate={canCreate} />;
}

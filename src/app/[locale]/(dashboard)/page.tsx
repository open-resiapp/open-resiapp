import { BoardHome } from "@/components/home/BoardHome";
import { OwnerHome } from "@/components/home/OwnerHome";
import { getViewer, isViewerGated } from "@/lib/home.server";

// Domov (BYT-20261117-002 Phase 4). Server component: the audience (owner
// vs board) follows the nav rule in src/lib/navigation.ts; every block is
// loaded server-side in parallel inside OwnerHome / BoardHome. The
// onboarding banner stays mounted by the layout.

export default async function HomePage() {
  const viewer = await getViewer();
  // Signed-out users are redirected by the layout; pending users only ever
  // see /community-info (PendingShell); users who must consent see only
  // ConsentGate — skip the queries for all of them.
  if (!viewer || isViewerGated(viewer)) return null;

  return viewer.audience === "board" ? (
    <BoardHome viewer={viewer} />
  ) : (
    <OwnerHome viewer={viewer} />
  );
}

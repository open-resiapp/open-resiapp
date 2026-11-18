// Client-safe mirror of counter-authz.server.ts `canRecordForVoting`: who may
// record paper ballots for ONE voting. Server remains the authority.
export function canRecordForVotingClient(
  user: { id: string; role: string; boardRoles?: readonly string[] } | null | undefined,
  voting: { voteCounterId: string | null } | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.boardRoles?.includes("chairman")) return true;
  return Boolean(voting?.voteCounterId && voting.voteCounterId === user.id);
}

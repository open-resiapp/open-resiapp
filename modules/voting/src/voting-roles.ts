// BYT-20261118-020 — membership roles that hold a vote. One constant for
// every eligibility filter of the voting module (cast, ballot snapshot,
// eligible set, total possible weight, presence, readiness, notifications)
// so a new voting role is never added in one place and forgotten in another.
//
//   owner  — vlastník bytu / nebytového priestoru (SK §14 ods. 3
//            zák. 182/1993; CZ §1206 zák. 89/2012)
//   member — člen bytového družstva (SK §240 Obch. zák. 513/1991:
//            "každý člen jeden hlas"; CZ §755 zák. 90/2012)
//
// Client-safe (no DB imports).

export const VOTING_ROLES = ["owner", "member"] as const;

export type VotingRole = (typeof VOTING_ROLES)[number];

export function isVotingRole(role: string | null | undefined): role is VotingRole {
  return role === "owner" || role === "member";
}

/** SQL literal list for raw `sql` fragments: `('owner', 'member')`. */
export const VOTING_ROLES_SQL_LIST = "('owner', 'member')";

---
subsystem: voting
last_updated: 2026-05-18
updated_by: filipvnencak (via /domain-extract)
---

## Mental model
Voting is the legally-binding HOA decision-making subsystem where every
cast vote must be unambiguously tied to a verified voter identity at
the moment of voting, with the entire process exportable as law-proof
evidence — and the UX must work for elderly owners who don't use
smartphones and are afraid of breaking something.

## Invariants
- A vote always belongs to a unit, never to an owner. The owner is the
  caster; the unit is the holder of the recorded stance.
- A unit's recorded stance is resolved from its owners' share-weighted
  inputs: majority of unit shares for the same choice wins. No majority,
  including any tie (50/50, three-way split), produces an abstain stance.
- A vote choice is always one of three values: for, against, abstain.
  Null, skipped, or other values must never exist.
- An electronic vote is never accepted on the basis of an authenticated
  session alone. The voter must perform an active confirming action
  within a short, single-use window (clicked email-confirmation link or
  passkey assertion). A merely-sent email is not capture.
- A paper vote always has an attached photograph of the signed ballot.
  Paper without photo must never be accepted.
- Mandates (proxy or delegated voting) do not exist in this system.
  Delegation is not legally defensible at the level required, so the
  per-share input model is used instead: a missing co-owner's share
  is simply uncast, and the unit-level resolution rule handles it.
  Absence of a forgeable delegation artefact is itself a legal feature.
- A closed voting's votes are immutable. Photos can be replaced when a
  dispute is logged; choices cannot.
- A voting is never deleted once active. Termination is via status
  transition (cancelled, archived), not row removal.
- A reopened voting always carries a written justification note that
  becomes part of the audit record.
- Cryptographic audit artefacts intended for independent verification
  (notary, court, external reviewer, grant evaluator) must never mix
  server-side secrets into the hashed payload. A third-party verifier
  has no DB access and no server secrets, so a secret-salted hash is
  unreproducible and therefore unverifiable. Authenticity for external
  audit comes from an asymmetric signature over hashes of public ballot
  data, not from secret-salted digests. Secret-salted hashes may still
  exist internally for DB-level tamper detection — that is a separate
  concern from external verifiability.
- Country-specific legal logic always lives inside the country's own
  voting module. Statutory references, quorum types, abstain semantics,
  and per-rollam rules never appear in shared code paths.

## Sign and direction conventions
| Field / concept | Direction / meaning |
|---|---|
| `for` | Counted toward the unit's positive share. |
| `against` | Counted toward the unit's negative share. |
| `abstain` (Slovakia) | Counted as `against` by fallback rule. |
| `abstain` (Czech Republic) | Ignored from majority calculation. |
| Silence / non-voter (Slovakia) | Not counted as against. |
| Silence / non-voter (Czech Republic) | Counted as against after the statutory per-rollam window. |
| Unit-level resolution | Majority of shares wins. No majority, including ties, resolves to `abstain`. |
| Voting status `draft` → `active` → `closed` | Terminal at closed unless explicitly reopened with a justification note. |
| Status `cancelled` / `archived` | Terminal disposition of a voting that will not produce a result. |

## Scope rule
- A voting belongs to one entity scope: a community, a building, or a
  specific entrance. Visibility is determined by membership-path overlap
  with that scope — an owner sees a voting iff their active membership
  is on an ancestor of, equal to, or a descendant of the voting's scope.
- A vote belongs to the unit. The owner identity is the caster on behalf
  of their share of that unit.
- A unit's resolved stance belongs to the (voting, unit) pair and is
  derived from the (voting, unit, owner) raw share-votes.
- Voting creation authority belongs to: admin, owner, and chairman.
  Other roles (board members, vote counter, residents) participate but
  do not initiate.
- Country-specific legal logic belongs to the country's own voting
  module. Cross-country code paths do not own statutory references.

## Counterparts and pairs
- Cast vote — confirmable within a short single-use window. If the
  window expires, no resend exists: the voter starts over.
- Create voting — cancellable while in `draft`. Once `active`, only
  archival or cancellation (with retained record), never deletion.
- Close voting — reopenable, but only with a written justification note
  that becomes part of the audit record. Re-tallying without reopening
  is not permitted.
- Paper vote with photo — photo is correctable when a dispute is logged.
  The choice itself is not.
- Vote dispute — flagged on the vote row with a note. Resolved by photo
  correction (paper) or admin annotation (electronic); never resolved
  by silent deletion.
- Mandate granted — does not exist. No counterpart.

## Edge cases
- Confusing `abstain` (explicit choice) with silence (non-voter). They
  are treated oppositely between Slovakia and Czech Republic, and a
  query that mixes them produces a result that is invalid in at least
  one of the two countries.
- Counting votes without applying per-share weighting. Under the
  per-share input model, summing ballots one-per-row produces a wrong
  result the moment any unit has co-owners.
- Writing country-specific rules in a shared code path. A statute
  change in one country silently affects the other's results. This is
  why the per-country module split exists; until it lands, every
  shared rule path is a legal liability.
- Treating a paper vote as recordable without its photograph. The
  photograph is the evidence of the signed ballot; without it the
  paper vote is unrecoverable.
- Querying votings without applying the membership-path filter.
  Per-entrance and per-building votings leak to non-members.
- Using any server-side secret in a hash that will appear in an
  externally-verifiable artefact. The verifier cannot reproduce such
  a hash, so the artefact's integrity claim collapses.
- Mutating any field on a closed-voting row. The closed state is the
  legal record; backfills, cleanups, and migrations must never touch
  it without an explicit, audited reason that is itself recorded.
- Reopening a closed voting without a justification note. The note is
  the only artefact that lets an auditor distinguish a legitimate
  correction from a tampering attempt.
- Forgetting that admin / owner / chairman are all valid voting
  creators. Code that hard-codes `role === 'admin'` blocks legitimate
  owner-initiated and chairman-initiated votings.
- Treating mandates as a planned feature. They are not coming back.
  Designs that assume "we'll add delegation later" must instead lean
  on the per-share input model.

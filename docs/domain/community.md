---
subsystem: community
last_updated: 2026-04-17
updated_by: filipvnencak (via /domain-extract)
---

## Mental model
Community is the shared space where residents (owners and tenants) of
a building post to each other, help each other, organize meet-ups,
and share skills — separate from formal HOA governance (voting,
mandates, legal records).

## Invariants
- A post always has a type (one of: offering to sell, offering for free,
  asking to borrow, asking for help, offering help, organizing an event).
- Event posts always have both a date and a location; non-event posts
  never carry date or location.
- A response always references an existing post.
- A directory entry always belongs to exactly one resident (one-to-one).
- Caretaker / external správca role never has access to community data.
- Admin always has moderation power over every post, response, RSVP,
  and directory entry — regardless of authorship.
- Post author is always an existing resident (owner or tenant).
- Contact details (phone, email) are only visible when the resident
  has explicitly opted in to sharing each specific field.
- Cross-building leakage is impossible: one building per app instance.

## Sign and direction conventions
| Field / concept | Direction / meaning |
|---|---|
| `expiresAt` | Future when created; past = post has expired |
| `eventDate` | Future = upcoming event; past = ended event |
| RSVP `yes` / `maybe` / `no` | Counted separately. `maybe` is not "half-yes". |
| Post status `active` → `resolved` | Terminal, user-confirmed (e.g. sold, helped). |
| Post status `active` → `expired` | Terminal, time-triggered. |
| Sort: marketplace, help | Newest first |
| Sort: events | Soonest upcoming first |

## Scope rule
- Community data is scoped to a building; a resident belongs to a
  building via their unit and entrance.
- A post optionally carries an entrance scope. No entrance scope =
  visible to the whole building. Entrance-scoped = default visible
  only to residents of that entrance.
- Admin controls a building-level setting that can override the
  entrance silo, making entrance-scoped posts visible to residents
  of other entrances too.
- A resident who belongs to multiple entrances sees posts from all
  of them (unioned).
- Directory entries are building-wide: every resident can see the
  opt-in entries of every other resident in the building.
- Ownership of a record: the author owns their post, response, RSVP,
  and directory entry. Author can modify or delete their own.
  Admin can modify or delete anyone's.

## Counterparts and pairs
- Create post ↔ delete own post (author or admin). No reopen once
  resolved in MVP.
- Respond to post ↔ admin can delete or hide the response.
  Residents cannot withdraw their own responses.
- RSVP yes ↔ RSVP no ↔ RSVP maybe. Freely toggled, reversible.
  One RSVP per resident per event.
- Opt-in to directory ↔ either toggle individual fields off
  (entry remains, fields hidden) or delete the entry entirely.
- Resolve post — terminal for MVP. Reopen is a future idea, not yet
  implemented.
- Auto-expire — no extend or renew. Author can delete and repost.

## Edge cases
- Treating community as governance: wiring community posts into
  voting, mandates, or documents pulls in caretaker visibility
  and mixes neighborly content with legal records. Community must
  stay isolated from governance subsystems.
- Copying owner-only permission checks (`role === 'owner'`) from
  voting code. Community explicitly includes tenants. Use
  community-specific permissions.
- Exposing phone or email from the `users` table directly. Always
  read from the directory entry and respect the per-field opt-in
  flags.
- Querying community posts without applying both the entrance
  filter and the building's cross-visible setting. The silo
  leaks only when admin has explicitly enabled cross-visibility.
- Counting attendees by summing all RSVP rows including `maybe`
  and `no`. Count each status separately.
- Forgetting that admin is not the author — admin can delete any
  post/response, and any ownership-based rule must allow admin as
  a bypass.
---
retro_for: RES-20260417-004
spec_title: "Community events – /komunita/udalosti"
created: 2026-04-28
status: applied
---

## Discrepancies

### 1. Event detail page never built
- **Category:** deferred
- **Spec said:** `/komunita/udalosti/[id]` detail page in scope
- **Implementation did:** Only list (`page.tsx`) and create (`nova/page.tsx`); no `[id]` route. Same pattern in `burza` and `pomoc`.
- **Why:** Cards on the list show all relevant info inline (date, location, organizer, RSVP counts, RSVP buttons), so the detail page was never needed in practice.

### 2. RSVP UX uses three explicit buttons instead of a single toggle
- **Category:** better_approach
- **Spec said:** Single "Zúčastním sa" / "Nezúčastním sa" button; repeated click flips yes ↔ no via UPSERT.
- **Implementation did:** Three explicit buttons (yes / maybe / no); clicking sets that status directly; clicking the active one is a no-op.
- **Why:** Direct status pickers are clearer than implicit toggles, and they let users reach `maybe` in one tap instead of cycling.

### 3. DELETE rsvp endpoint added
- **Category:** spec_incomplete
- **Spec said:** Only `POST /api/community/posts/[id]/rsvp`.
- **Implementation did:** Added `DELETE /api/community/posts/[id]/rsvp` to remove the user's RSVP entirely (full undo, not just status flip).
- **Why:** Users need a way to retract an RSVP, not only change its status. Spec covered create/update but missed undo.

### 4. FK `onDelete: "cascade"` added in schema
- **Category:** spec_incomplete
- **Spec said:** `references(() => communityPosts.id).notNull()` and `references(() => users.id).notNull()` — no `onDelete` specified.
- **Implementation did:** `onDelete: "cascade"` on both FKs in `event_rsvps`.
- **Why:** Without cascade, deleting a post or user would fail while RSVPs reference it. Spec forgot to specify FK behavior; cascade is the right choice for owned child rows.

### 5. Card layout uses shared `PostCard`, not a bespoke event card
- **Category:** better_approach
- **Spec said:** Bespoke card mock with prominent date header, single CTA "Zúčastním sa".
- **Implementation did:** Reused generic `PostCard` and injected an RSVP block (counts + three buttons) as children.
- **Why:** Shared component already covered title, content, photo, author, entrance, and management actions. Building a bespoke card would have duplicated all of that.

## Deferred Items

- [ ] `/komunita/udalosti/[id]` detail page — deferred because: card surface area is sufficient; revisit only if a real need appears (long descriptions, photo galleries, comment threads).

## Findings

### 1. Prefer explicit per-state buttons over implicit toggles
- **Target:** claude_md
- **From discrepancy:** #2
- **Recommendation:** When speccing a multi-state user choice (RSVP yes/maybe/no, vote for/against/abstain, status filters), default to explicit per-state buttons. Avoid hidden state machines where one button cycles values — harder to read, harder to test, slower to reach non-default states.
- **Applied:** yes

### 2. Specs for per-user mutable records must cover the undo path
- **Target:** claude_md
- **From discrepancy:** #3
- **Recommendation:** When a spec introduces a per-user mutable record (RSVP, opt-in entry, subscription, draft), the Approach and Acceptance Criteria sections must explicitly cover the undo/delete path, not only create/update. Suggest adding an "Undo" prompt to the spec-new template's acceptance criteria checklist.
- **Applied:** yes

### 3. Drizzle FK references must always specify `onDelete`
- **Target:** claude_md
- **From discrepancy:** #4
- **Recommendation:** Every `references(...)` call in `src/db/schema.ts` must specify an `onDelete` policy. Default (no action) is almost never correct. Use `cascade` for child rows owned by the parent; `set null` for soft references; `restrict` only when a hard block is intentional and documented.
- **Applied:** yes

### 4. Spec card mocks are illustrative, not prescriptive
- **Target:** claude_md
- **From discrepancy:** #5
- **Recommendation:** When a shared UI component already covers a feature's data shape (e.g. `PostCard` for community posts), reuse it and inject feature-specific children. A new bespoke card layout per feature requires explicit justification in the spec — visual mocks alone are not enough.
- **Applied:** yes
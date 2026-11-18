---
spec_id: BYT-20261118-020
title: "Bytové družstvo (housing cooperative) template + accountant / správca roles"
status: idea
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20260515-001   # multi-kind templates (src/lib/templates, voting-method dispatch)
  - BYT-20261118-002   # voting end-to-end workflow (notice.ts, PDFs)
related_handoffs: []
tags: [druzstvo, cooperative, templates, roles, voting, legal-copy, accounting]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

The app can run a **bytové družstvo** (housing cooperative), not only an SVB / SVJ. Its
members vote one member = one vote, the board is predstavenstvo + kontrolná komisia,
meetings are announced under the stanovy (SK) or the statute (CZ), and the voting documents
cite the cooperative law, not zák. 182/1993. Two staff roles get added: **účtovník**
(accountant) and **správca** (management company).

Persona: a retired economics professor who chairs an SVB and also manages a bytové
družstvo. He reads the statute, and he will check every citation and every vote count.

### Problem statement (verified 2026-11-18)

- No cooperative template: `src/lib/templates/*.json` has `hoa` and 19 non-residential kinds.
- Members would have to be `tenant`, and tenants cannot vote: `vote: ["admin", "owner"]`
  (`src/lib/permissions.ts:8` before this change).
- The engine supports `one_per_member` (`src/lib/voting-method.ts:17`), but settings offer
  only share / flat / area (`src/components/settings/VotingSettingsTab.tsx:17-21`).
- The notice lead time depends only on the country (`modules/voting/src/workflow/notice.ts:31-34`).
- Legal texts are tied to zák. 182/1993. The law library had no 513/1991 and no 90/2012.
- `governance_model` ∈ {chairman_council, committee, chairman_only}. None of them is
  predstavenstvo + kontrolná komisia.
- No accountant role. Accounting authz works only through the board role treasurer / chairman
  (`modules/accounting/src/lib/authz.ts:10-12`). Caretaker has no accounting.

## Legal basis (quoted from data/laws, synced 2026-11-18 via `pnpm laws:sync`)

The law library now includes **sk-513-1991** (Obchodný zákonník, § 221 – § 260, effective
2026-08-17) and **cz-90-2012** (zákon o obchodních korporacích, § 552 – § 757, effective
2024-07-19).

**SK — Obchodný zákonník 513/1991 Zb.**

- § 238 ods. 3: "…vyžaduje sa na platnosť uznesenia členskej schôdze … ich riadne zvolanie,
  prítomnosť nadpolovičnej väčšiny členov a súhlas väčšiny hlasov prítomných členov.
  Tento zákon alebo stanovy určujú, pre ktoré uznesenia je potrebný súhlas kvalifikovanej väčšiny."
- § 239 ods. 1–2: "Najvyšším orgánom družstva je schôdza členov družstva (ďalej len „členská
  schôdza“). Členská schôdza sa schádza v lehotách určených stanovami, najmenej raz za rok.
  Zvolanie členskej schôdze sa musí členom oznámiť **spôsobom určeným stanovami**."
  → The statute sets **no** minimum notice period. The stanovy set it.
- § 239 ods. 6: náhradná členská schôdza within three weeks, "schopná uznášať sa bez ohľadu
  na ustanovenie § 238 ods. 3".
- § 240: "Pri hlasovaní má každý člen jeden hlas, pokiaľ stanovy neurčujú inak. Stanovy
  nemôžu určiť inak, ak ide o rozhodovanie podľa § 239 ods. 4 písm. g) alebo rozhodovanie o
  zrušení družstva s likvidáciou."
  (The brief cited § 239 for this rule. The rule is in **§ 240**.)
- § 241: the zápisnica must contain the date and place, the resolutions, the voting results
  and the objections; "Prílohu zápisnice tvorí zoznam účastníkov schôdze, pozvánka na ňu a podklady…".
- § 243: predstavenstvo is the statutory body. § 244: kontrolná komisia has at least three
  members. § 245: a cooperative with fewer than 50 members can give these powers to the
  členská schôdza.

**SK — zák. 182/1993 Z. z.** still applies to the **building**. The družstvo is the owner of
the building (or of flats in it) and may also act as správca (§ 8a: zmluva o výkone správy).
In an SVB, § 14 ods. 3 says: "Za každý byt a nebytový priestor v dome má vlastník … jeden hlas"
— votes are per unit, so `one_per_member` stays **hidden for an SK HOA**.

**CZ — zákon č. 90/2012 Sb., o obchodních korporacích**

- § 552: a družstvo has at least 3 members. § 727: "Bytové družstvo může být založeno jen za
  účelem zajišťování bytových potřeb svých členů. Bytové družstvo může spravovat domy s byty a
  nebytovými prostory ve vlastnictví jiných osob."
- § 636 ods. 1: "Svolavatel **nejméně 15 dnů** přede dnem konání členské schůze uveřejní
  pozvánku … na informační desce družstva a současně ji zašle členům…" → a statutory minimum
  that the stanovy may only lengthen.
- § 644: quorum is "většina všech členů majících většinu všech hlasů". § 645: majority of the
  votes of the members present. § 648: a náhradní schůze has a quorum whatever the attendance.
- § 653 písm. b): per rollam response period "určenou stanovami, jinak 15 dnů".
- § 755: "Každý člen bytového družstva má při hlasování na členské schůzi 1 hlas; ustanovení
  § 650 odst. 1 se nepoužije. Jedná-li se o společné členy, mají dohromady 1 hlas. … mohou
  stanovy určit, že členové …, kteří jsou nájemci družstevních bytů, mají na členské schůzi
  vyšší počet hlasů; § 650 odst. 2 není dotčen."

## Scope

In: the template, the `member` / `accountant` / `spravca` roles, the governance model
`board_supervisory` and its board roles, statute-gated voting methods, a stanovy-configurable
notice period with a statutory floor, the legal-copy module, and the two laws in the library.

### Non-goal: several communities in one instance

The persona chairs an SVB **and** manages a družstvo. He still runs **two instances** (two
subdomains), and we keep it that way:

- Single-root code paths. `getCommunityRoot()` returns one root, and settings, shell, voting,
  accounting (one chart of accounts, one ledger) and branding all read it.
  `bootstrap-community.ts` stops when a root exists.
- One instance = one legal regime. Regime-dependent behaviour (votes, notice, statutory PDFs)
  is resolved once per instance. With two roots, every check would need a root id, and a
  mistake would print the wrong statute.
- Data isolation and GDPR: two different data controllers (SVB vs družstvo). Today one
  database per controller is the boundary. Mixing them in one instance would need row-level
  scoping first.
- The cloud already provisions one instance per customer. A person in several communities is
  an SSO / identity question (open-resiapp-cloud), not a multi-root question.

## Approach

1. **Template** `src/lib/templates/bytove_druzstvo.json` (category `residential`,
   import levels community → building → entrance → unit, `unit_type` flat / non_residential /
   garage reusing `src/lib/unit-type.ts`, so no new kinds). Default voting `one_per_member`,
   `member_role: member`, `default_governance_model: board_supervisory`,
   `notice.default_lead_days: 15`, `legal_review_required: true`.
2. **Regime** `src/lib/legal-copy/regime.ts`: template slug → `hoa | cooperative | other`.
   Legacy installs with no slug count as HOA.
3. **Voting methods** (`src/lib/voting-method.ts` `allowedVotingMethods`): HOA = share / unit /
   area (unchanged); cooperative = `one_per_member` (default) + `custom_weight` (stanovy);
   other = all. The settings radio list follows this. The server must enforce it too
   (`isVotingMethodAllowed`, called from PATCH /api/building).
4. **Notice** (`notice.ts`): `effectiveLeadDays = max(statutory, stanovy)`. Statutory floor:
   HOA SK 7 (§ 14a ods. 2, unchanged), HOA CZ none (unchanged), cooperative SK none (§ 239 ods. 2),
   cooperative CZ 15 (§ 636). The stanovy value is stored at `entities.data.notice_lead_days`.
   Bootstrap seeds it from the template default. Validation:
   `validateNoticeLeadSetting` → stable codes.
5. **Roles**: `member` has the same rights as `owner`, including `vote`. `accountant` gets
   `readAccounting` + `writeAccounting` and nothing else. `spravca` gets board-like operational
   rights (posts, votings, paper votes, documents upload, faults, accounting read/write) but no
   settings, no API keys, no user/role management and no document deletion. Approvals
   (závierka) stay with the chairman for both staff roles, for separation of duties.
6. **Governance** `board_supervisory`: board roles `chairman` (predseda predstavenstva),
   `board_member`, `supervisory_chairman`, `supervisory_member`.
7. **Legal copy** `src/lib/legal-copy/index.ts` `getLegalCopy(templateSlug, country)` →
   `{ regime, signedOff per document, statuteCitations, keys{noticeTitle, noticeLegalBasis,
   ballotHeading, ballotMemberLabel, attendanceHeading, minutesHeading, memberLabel, …},
   votingMethods, defaultVotingMethod }`. The keys are i18n keys. The HOA keys resolve to the
   exact strings used today. The cooperative entries ship with `signedOff = false`, so the PDFs
   keep refusing to render them until the wording is reviewed.

## Acceptance Criteria

1. The template picker lists "Bytové družstvo" (sk / cs / en). Bootstrapping with it writes
   `template_slug = bytove_druzstvo`, `voting_method = one_per_member`,
   `governance_model = board_supervisory` and `notice_lead_days = 15` on the root.
2. A user with role `member` and an active membership on a unit can vote. Each member counts
   1, however many units they hold. Joint members (CZ § 755 "společní členové") count 1 together.
   **Undo:** an admin can change the role back to `tenant` / `owner`, or archive the membership.
   An archived member drops out of eligibility for votings not yet frozen. Votes already cast
   are kept (audit).
3. On a cooperative install, Settings → Hlasovanie offers exactly `one_per_member` and
   `custom_weight`. On an SK or CZ HOA install it offers exactly share / unit / area, and NOT
   one_per_member. The test asserts the full set, not just presence. PATCH /api/building rejects
   a method outside the set with a stable code.
   **Undo:** switching back to the previous method is a normal save. Frozen votings keep
   `frozenVotingMethod`.
4. Notice: SK HOA keeps 7 full days. CZ cooperative refuses a start date earlier than notice
   day + 16 (15 full days). SK cooperative enforces only the stanovy value; with no value it
   enforces nothing. The stanovy field refuses values below the statutory floor and values
   above 90. **Undo:** clearing the field stores `null` (= statutory floor only).
5. `accountant` sees Financie (nav + pages), can post and import accounting entries, and
   cannot approve. They see no Nastavenia, no Vlastníci, no Oznamy create, and cannot vote. The
   full nav set is asserted. **Undo:** changing the role removes access on the next request,
   because authz reads the live role.
6. `spravca` can create notices and votings, record paper votes, upload documents, manage
   faults and read / write accounting. They cannot open settings, manage users or roles, manage
   API keys, delete documents or approve. **Undo:** as in AC 5.
7. Governance model "Predstavenstvo + kontrolná komisia" is selectable. The board tab offers
   exactly the four board roles. **Undo:** a board member can be removed (existing flow).
   Switching the model back hides those roles from new assignments but keeps the history.
8. `getLegalCopy("hoa" | null, "sk")` resolves to strings byte-identical to the current
   documents (notice title / legal basis, ballot heading / owner, attendance headings, minutes
   "ZÁPISNICA Z HLASOVANIA", column "Vlastník"). A snapshot test covers all of them.
9. Statutory PDFs (notice, ballot, attendance, minutes) do **not** render for a cooperative
   until `signedOff` is flipped after legal-copy review of `LegalCopy.cooperative.*`. The
   callers show the existing "unavailable" message instead.
10. The law reader opens `sk-513-1991` § 240 and `cz-90-2012` § 755. MCP `find_legal_basis`
    can cite them.

## Notes

### Decisions to confirm

1. `member` as a **new role** vs reusing `owner` with a "člen" label only. The new role is
   cleaner legally, but it costs every `"owner"` literal in the voting engine (see the
   integration list in the agent report). The label-only alternative is a much smaller change.
2. `custom_weight` has no weight-editing UI (admin API / MCP only). Ship the option hidden
   until a UI exists?
3. Should `spravca` manage users? It is excluded now (privilege escalation: it could grant
   `admin`).
4. SK cooperative per rollam: the Obch. zák. does not regulate it. Allow it only when the
   stanovy permit it (a setting)?
5. CZ § 636 day counting: same "full days between" rule as SK HOA? (needs legal sign-off)
6. § 245 small cooperatives (< 50 members, no predstavenstvo / KK): support as
   `chairman_only`?

### Legal-copy sign-off required

All `LegalCopy.cooperative.*` strings, `Templates.bytove_druzstvo.description`,
`BoardMembers.model_board_supervisory`, the voting-method descriptions, and the notice-period
hints.

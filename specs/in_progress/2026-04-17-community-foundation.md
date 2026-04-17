---
spec_id: RES-20260417-001
title: "Community foundation – schema, API, permissions, navigation"
status: in_progress
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-17
project_type: feature
depends_on: []
related_handoffs: []
tags: [community, schema, api, foundation]
---

## Goal
Pridať do open-housing appky sekciu **Komunita** – čisto susedský
priestor bez správcovských funkcií. Táto spec pokrýva zdieľané
základy: DB schema, API routes pre posts + responses, permissions,
navigáciu a shared UI komponenty. Nad týmto foundationom potom
vzniknú jednotlivé podsekcie (burza, pomoc, udalosti, adresár)
ako samostatné specs.

## Scope

### V scope
- DB schema: `community_posts`, `community_responses`, enumy
  `community_post_type`, `community_post_status`
- Pridať stĺpec na `building` tabuľku:
  `community_cross_entrance_visible boolean NOT NULL DEFAULT false`
  – admin toggle či entrance-scoped posty presakujú medzi vchodmi
- Drizzle migrácia (`npm run db:generate && npm run db:migrate`)
- Spoločné API routes:
  - `GET/POST /api/community/posts`
    – query `includeResolved=true` + `includeExpired=true` pre toggle
  - `GET/PATCH/DELETE /api/community/posts/[id]`
    – DELETE dostupné pre autora alebo admina
  - `POST /api/community/posts/[id]/respond`
  - `DELETE /api/community/posts/[id]/respond/[responseId]`
    – moderácia: len admin alebo autor danej response (TBD)
- Permissions (`communityPermissions` v `src/lib/permissions.ts`)
  – pre všetky roly vrátane nájomcov
- Navigačný entry `/komunita` v `Sidebar.tsx`
- `/komunita` landing page s odkazmi na 4 podsekcie
- Auto-expirácia postov po 30 dňoch (`expiresAt`)
- Shared UI komponenty: `PostCard`, `PostForm`, `ResponseList`
- i18n kľúče v `sk.json` a `en.json` (Komunita namespace)
- Úprava `/api/uploads/route.ts`: pridať per-category permission mapping
  (category `community-posts` → permission `uploadCommunityPhoto`)
- Nová permission `uploadCommunityPhoto` v `src/lib/permissions.ts`
  – povolená všetkým rolám (owner, tenant, admin)

### Mimo scope
- Konkrétne podsekcie (burza/pomoc/udalosti/adresár) – vlastné specs
- Email notifikácie – vlastná spec
- Directory (`directory_entries`) – vlastná spec
- Real-time updates / WebSocket
- Mazanie postov (MVP rieši len `resolved` status)

## Approach

### Dátový model (`src/db/schema.ts`)
```typescript
export const communityPostTypeEnum = pgEnum('community_post_type', [
  'sale', 'free', 'borrow', 'help_request', 'help_offer', 'event',
])

export const communityPostStatusEnum = pgEnum('community_post_status', [
  'active', 'resolved', 'expired',
])

export const communityPosts = pgTable('community_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: communityPostTypeEnum('type').notNull(),
  status: communityPostStatusEnum('status').notNull().default('active'),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  photoUrl: varchar('photo_url', { length: 1000 }),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  eventDate: timestamp('event_date'),
  eventLocation: varchar('event_location', { length: 255 }),
  entranceId: uuid('entrance_id').references(() => entrances.id),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const communityResponses = pgTable('community_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').references(() => communityPosts.id).notNull(),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Permissions (`src/lib/permissions.ts`)
```typescript
export const communityPermissions = {
  viewPosts:        (role) => role !== 'caretaker',
  createPost:       (role) => role === 'owner' || role === 'tenant' || role === 'admin',
  respondToPost:    (role) => role === 'owner' || role === 'tenant' || role === 'admin',
  resolvePost:      (role, isAuthor) => role === 'admin' || isAuthor,
  deletePost:       (role, isAuthor) => role === 'admin' || isAuthor,
  moderateResponse: (role) => role === 'admin',
  uploadCommunityPhoto: (role) => role === 'owner' || role === 'tenant' || role === 'admin',
  changeCrossEntranceVisibility: (role) => role === 'admin',
}
```
Komunita je otvorená pre **owner, tenant, admin**. Roly
**caretaker** a **vote_counter** NEMAJÚ prístup (caretaker je externá
správcovská spoločnosť – viď glossary).
**Admin** vždy vie zmazať/hide čokoľvek (bypass author-only pravidiel).

### API
- `GET /api/community/posts?type=sale&status=active&includeResolved=false&includeExpired=false`
  → filter podľa `type` (optional, comma-separated pre viacero)
  → default: `status='active' AND expiresAt > now()`
  → `includeResolved=true` → pridá `status='resolved'`
  → `includeExpired=true` → nepoužije `expiresAt > now()` filter
  → **entrance scope filter:**
    - ak viewer má nastavený vchod X → vráti posty s `entranceId IN (X, NULL)`
    - ak building má `community_cross_entrance_visible=true` → vráti všetky
    - admin vidí všetko vždy
    - caretaker 403
- `POST /api/community/posts`
  → validácia: `title`, `content`, `type` povinné
  → `expiresAt = now() + 30 days` nastaví backend
  → `eventDate`/`eventLocation` povinné iba pre `type='event'`
- `GET /api/community/posts/[id]` → post + responses + author info
- `PATCH /api/community/posts/[id]` → len autor alebo admin,
  mení `status` na `resolved`
- `DELETE /api/community/posts/[id]` → autor alebo admin,
  soft-delete (alebo hard, TBD), vrátane kaskády responses
- `POST /api/community/posts/[id]/respond` → pridá response,
  trigger email notifikáciu autorovi (hook-point pre spec 006)
- `DELETE /api/community/posts/[id]/respond/[responseId]` → moderácia,
  len admin môže mazať alebo hide cudzie responses

### Navigácia
Pridať položku do `Sidebar.tsx` nad Settings:
```
{ href: "/komunita", labelKey: "community", icon: "🏘️" }
```
Viditeľné pre všetky roly (žiadna permission).

### Shared UI komponenty (`src/components/community/`)
- `PostCard.tsx` – základná karta s type badge, title, content,
  author + byt/vchod, timestamp, CTA slot
- `PostForm.tsx` – formulár na vytvorenie postu, dynamické polia
  podľa `type`
- `ResponseList.tsx` – list reakcií pod postom
- `ResponseModal.tsx` – modal s textarea "Mám záujem"

### i18n
Namespace `Community` v oboch `sk.json` a `en.json`:
- navigácia, prázdne stavy, validačné hlášky, typ badges
- Tón: priateľský a susedský, nie inštitucionálny

## Acceptance Criteria
- [ ] Migrácia pre `communityPosts`, `communityResponses` + enumy prejde
- [ ] Migrácia pridá `community_cross_entrance_visible` na `building`
- [ ] `GET /api/community/posts` vracia default `active` a nevypršané
- [ ] `includeResolved=true` / `includeExpired=true` togglujú filter
- [ ] Entrance scope filter rešpektuje viewer entrance + building toggle
- [ ] Caretaker dostane 403 na všetky community endpointy
- [ ] `POST /api/community/posts` nastaví `expiresAt = now() + 30d`
- [ ] `PATCH` na status `resolved` odmietnutý pre nie-autora/nie-admina
- [ ] `DELETE /api/community/posts/[id]` funguje pre autora/admina
- [ ] `DELETE /api/community/posts/[id]/respond/[responseId]` len admin
- [ ] `POST /api/community/posts/[id]/respond` uloží response
- [ ] Upload test: `POST /api/uploads` s category `community-posts`
      prechádza pre owner/tenant/admin, zamietnutý pre caretaker
- [ ] Navigačná položka "Komunita" viditeľná pre owner/tenant/admin,
      skrytá pre caretaker/vote_counter
- [ ] `/komunita` landing page zobrazí dlaždice na 4 podsekcie
- [ ] Shared komponenty `PostCard`/`PostForm`/`ResponseList`/`EntranceScopePicker` existujú
- [ ] Prázdny stav: "Zatiaľ žiadne príspevky. Buď prvý! [+ Pridať]"
- [ ] Mobilne responzívne (full-width karty)
- [ ] i18n kľúče v `sk.json` a `en.json`, žiadny hardcoded text

## Project Context
- Závislosti: `entrances` tabuľka (pre `entranceId`),
  `users` (pre `authorId`), `user_role` enum (pre permissions)
- Navigácia v `src/components/layout/Sidebar.tsx`
- Schema v `src/db/schema.ts`
- Permissions v `src/lib/permissions.ts`
- API routes v `src/app/api/community/`
- Stránky v `src/app/[locale]/(dashboard)/komunita/`

## Notes
- Cron job na auto-expiráciu (`status='active' → 'expired'`
  keď `expiresAt < now()`) – zvážiť v spec 006 alebo samostatne
- Fotky: **2026-04-17 rozhodnutie: reuse filesystem uploads**
  (`src/app/api/uploads/route.ts`), category `community-posts`,
  max 5MB (override z default 10MB na client-side validácii),
  types `image/jpeg|png|webp`. Žiadny nový storage provider.
- Tone guideline pre copywriter: susedský, nie "Vážený vlastník..."

### Vzťah k existujúcim specs
- **RES-20260312-001 (voting/posting per entrance)** – rovnaký
  pattern `entranceId` (NULL = celá bytovka, X = len vchod X).
  **2026-04-17 rozhodnutie: Community foundation owns `EntranceScopePicker`.**
  Build `src/components/shared/EntranceScopePicker.tsx` v tejto spec.
  RES-312-001 ho bude reusovať keď landne (možno rozšíriť o
  voting-specific constraints, ale base API ostáva).
- **RES-20260312-003 (discussion threads with polls)** – je to
  INÝ primitive než community posts. Mentálny model pre user copy:
  - `Hlasovanie` = formálne, právne záväzné
  - `Diskusia` = neformálny group chat nad jednou témou
  - `Správy` = súkromné 1:1
  - `Komunita` = susedské (burza, pomoc, udalosti, adresár)
  UI copy v `Community` namespace musí toto rozlíšenie držať.
- **Security:** rovnaké hardening rules ako vo implemented specu
  external-api-security – rate limit, input validation, auth check
  per route.
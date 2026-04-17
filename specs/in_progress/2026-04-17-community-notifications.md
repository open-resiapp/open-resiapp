---
spec_id: RES-20260417-006
title: "Community email notifications + auto-expiration"
status: in_progress
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-17
project_type: feature
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [community, email, notifications, cron]
---

## Goal
Email notifikácie pre komunitné eventy (reakcie, expirácia,
pripomienky udalostí) + cron/scheduled job na auto-expiráciu
postov. Držané oddelene od foundation-u, aby foundation nezávisel
od email stacku.

## Scope

### V scope
- `sendCommunityResponseNotification(post, author, responder)`
  → email autorovi keď niekto reaguje
- `sendPostExpiryReminder(post, author)`
  → email autorovi 3 dni pred `expiresAt`
- `sendEventReminder(post, rsvps)`
  → email účastníkom deň pred `eventDate`
- Scheduled job / cron:
  - Raz denne prejde `community_posts`
  - Set `status='expired'` pre `status='active' AND expiresAt < now()`
  - Pre eventy: `status='expired'` 7 dní po `eventDate`
  - Pošle expiry reminder 3 dni pred `expiresAt`
  - Pošle event reminder deň pred `eventDate`
- Seed data (`src/db/seed.ts`):
  - 3 burza posty (sale, free, borrow)
  - 2 help posty (prosím, ponúkam)
  - 2 event posty (grilovačka, brigáda)
  - 2-3 directory entries
- Throttle / anti-spam: max 1 notifikácia per (author, post) per hodinu

### Mimo scope
- Push notifikácie (browser / mobile)
- SMS notifikácie
- Per-user nastavenie (opt-out per channel) – Fáza 2
- Digest email (denný súhrn) – Fáza 2

## Approach

### Email funkcie (`src/lib/email.ts`)
**2026-04-17: reuse existujúci `src/lib/email.ts`** – nodemailer + SMTP
(env vars `SMTP_HOST/PORT/USER/PASS/EMAIL_FROM`), pattern z
`sendPasswordReset`. Žiadny nový provider. Resend v package.json
zostáva nevyužitý, nerozbíjať.

```typescript
export async function sendCommunityResponseNotification(
  post: CommunityPost,
  author: User,
  responder: User,
  responseContent: string
): Promise<void>

export async function sendPostExpiryReminder(
  post: CommunityPost,
  author: User
): Promise<void>

export async function sendEventReminder(
  post: CommunityPost,
  recipient: User
): Promise<void>
```

Obsah emailu: stručný, odkaz do app, žiadne senzitívne dáta.

### Integrácia s API
- `POST /api/community/posts/[id]/respond` → po uložení zavolá
  `sendCommunityResponseNotification`
- Throttle: tabuľka `notification_throttle` alebo Redis (existujúci
  pattern v byt-app) – ak nie je, inline kontrola posledného emailu
  v `sent_emails` tabuľke (ak existuje)

### Cron / Scheduled job
**2026-04-17 rozhodnutie: Docker sidecar cron kontajner (D1)**
v `docker-compose.prod.yml`. Portable cez AWS/Hetzner/Railway.

```yaml
# docker-compose.prod.yml
cron:
  image: alpine:latest
  restart: unless-stopped
  depends_on: [app]
  environment:
    CRON_SECRET: ${CRON_SECRET}
    APP_URL: http://app:3000
  command: >
    sh -c "apk add --no-cache curl &&
    echo '0 7 * * * curl -fsS -H \"X-Cron-Secret: $$CRON_SECRET\" $$APP_URL/api/cron/community' > /etc/crontabs/root &&
    crond -f -l 2"
```

- Beh: 1× denne 07:00 UTC
- Endpoint `/api/cron/community` auth cez `X-Cron-Secret` header
- `.env.example` pridá `CRON_SECRET`
- Debug endpoint (pattern z open-resiapp-cloud):
  `GET /api/admin/debug/cron` – posledný beh, counts, errors
- Logy cez `console.log` – `docker logs byt-app-cron-1`

**Alternatíva pre in-process (D3 – mirror sibling project):**
- Next.js `instrumentation.ts` + `node-cron`
- Odložené kým daily batch nebude nestačiť, alebo kým byt-app
  nebude potrebovať častejšie joby (rovnaký pattern ako
  open-resiapp-cloud `instance_scheduler.py`)

### Seed data
Pridať do `src/db/seed.ts` po existujúcich seedoch,
s referenciami na existujúcich seed users (`jan@test.sk`, atď.).

## Acceptance Criteria
- [ ] `sendCommunityResponseNotification` pošle email autorovi
- [ ] Throttle: max 1 email per 60 min pre rovnakú dvojicu (post, responder)
- [ ] `sendEventReminder` pošle email všetkým `rsvp:yes` účastníkom
      deň pred `eventDate`
- [ ] `sendPostExpiryReminder` pošle email 3 dni pred `expiresAt`
- [ ] Cron job prepne `status='active' → 'expired'` pre expirované posty
- [ ] Cron job pre eventy používa `eventDate + 7d` namiesto `expiresAt`
- [ ] Seed data vytvorí ukážkové posty a directory záznamy
- [ ] `npm run db:seed` prejde bez chyby
- [ ] Žiadny email neposiela obsah s telefónom/emailom bez opt-inu
      (cez directory rules)
- [ ] Email copy v slovenčine (primárne) + en fallback

## Project Context
- Email stack: závisí od rozhodnutí v byt-app (Resend / SMTP / iné).
  Zistiť pred implementáciou či už existuje `src/lib/email.ts`.
- Cron: zvoliť platformu – Railway/Vercel/Supabase.
  Ak byt-app nemá žiaden cron, toto bude prvý.
- Seed: `src/db/seed.ts` – existujúci pattern pre pridanie záznamov

## Notes
- Dôležité: rezidentova schránka sa nesmie zahltiť.
  Ak dostane 20 responsov za hodinu, dostane 1 email s počítadlom
  „Máš 20 nových reakcií" – nice-to-have, nie MVP.
- 2026-04-17: cron platforma vybraná – Docker sidecar (alpine + crond + curl).
  Reference: open-resiapp-cloud `backend/app/services/instance_scheduler.py`
  používa in-process asyncio, my ideme sidecar (daily batch, nie per-10s).
- 2026-04-17: email stack potvrdený – nodemailer + SMTP v `src/lib/email.ts`.
  Nové funkcie pridať rovnakým patternom ako `sendPasswordReset`
  (return `boolean`, graceful skip keď SMTP nie je configured).

### Vzťah k existujúcim specs
- **RES-20260312-002 (messages owners-to-owners)** – zdieľaná
  infraštruktúra emailu. Ak 312-002 landne prvé, reuse
  `src/lib/email.ts` + throttle pattern + sent_emails tabuľku.
  Ak táto spec landne prvá, navrhnúť štruktúru tak aby ju 312-002 prevzala.
- **Implemented: external-api-security-hardening** –
  endpoint `/api/cron/community` musí byť chránený cron secret
  header (Vercel Cron / Railway signed request), rovnaký vzor
  aký má byt-app pre iné hardened endpointy.
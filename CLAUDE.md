# CLAUDE.md

Project instructions for Claude Code. This file is automatically loaded when working in this repository.

## Project Overview

OpenResiApp — open-source web app for managing Slovak residential apartment buildings (bytove domy). Features: announcements board, weighted voting, owner management, documents, role-based access.

## Tech Stack

- **Next.js 16** with App Router (`src/app/`)
- **TypeScript** — strict mode
- **Tailwind CSS** — utility-first styling
- **PostgreSQL 16** — database
- **Drizzle ORM** — schema in `src/db/schema.ts`, migrations via drizzle-kit
- **NextAuth v5** (beta.25) — credentials provider, config in `src/lib/auth.ts`
- **Docker + Caddy** — deployment

## Key Architecture

- Route groups: `(auth)` for login, `(dashboard)` for protected pages
- Dashboard routes: `/board`, `/voting`, `/owners`, `/settings`
- API routes mirror the domain: `/api/posts`, `/api/votings`, `/api/users`, `/api/votes`, `/api/flats`, `/api/mandates`, `/api/documents`
- All API routes use `auth()` from NextAuth for session checks
- Permissions system in `src/lib/permissions.ts` — role-based (admin, owner, tenant, vote_counter)
- Voting logic with weighted shares in `src/lib/voting.ts`
- Types in `src/types/index.ts`

## Important Files

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | All 10 database tables + relations |
| `src/lib/auth.ts` | NextAuth v5 configuration |
| `src/lib/permissions.ts` | RBAC permission definitions |
| `src/lib/voting.ts` | Weighted voting calculation |
| `src/types/index.ts` | Shared TypeScript types |
| `src/components/layout/Sidebar.tsx` | Main navigation |
| `src/components/Providers.tsx` | SessionProvider wrapper |
| `docker-compose.yml` | Docker services (db, app, caddy) |

## Code Conventions

- **All UI text is in Slovak** (labels, buttons, error messages, placeholders)
- **All code is in English** (variables, functions, file names, routes, comments)
- Minimum font size 16px for accessibility (WCAG AA)
- Blue primary color (`blue-600` / `blue-700`)
- Use `text-base` (16px) for body text, `text-sm` for secondary info
- Input styling: `w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none`
- Card styling: `bg-white rounded-xl border border-gray-200 p-6`
- Button styling: `px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors`

## Commands

```bash
# Database (requires Docker or local PostgreSQL)
docker compose up db          # Start local PostgreSQL
npm run db:generate           # Generate Drizzle migrations
npm run db:migrate            # Run migrations
npm run db:seed               # Seed with test data
npm run db:studio             # Open Drizzle Studio

# Development
npm run dev                   # Start dev server on :3000
npm run build                 # Production build
npm run lint                  # ESLint
```

## Do NOT

- Do not run `npm run dev`, `npm run lint`, or `npm run build` — the developer will test manually
- Do not add unnecessary abstractions or over-engineer solutions
- Do not change the Slovak UI text language to English
- Do not modify database schema without explicit request
- Do not commit `.env` files or credentials

## API Route Patterns

All API routes follow this pattern:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  // ... query with drizzle
}
```

Dynamic routes use `params: Promise<{ id: string }>` (Next.js 14 pattern):

```typescript
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ...
}
```

## Test Credentials (seed data)

- Admin: `admin@test.sk` / `Admin123!`
- Owners: `jan@test.sk`, `maria@test.sk`, `peter@test.sk`, `anna@test.sk` (all `Admin123!`)

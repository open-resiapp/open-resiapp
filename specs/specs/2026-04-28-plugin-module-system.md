---
spec_id: RES-20260428-002
title: "Plugin/Module System"
status: spec
created: 2026-04-28
updated: 2026-04-28
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-28
project_type: architecture
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [modules, plugins, extensibility, sdk]
changelog_version: ""
changelog_date: ""
docs_version: ""
---

## Goal

Enable third-party developers and self-hosted operators to extend open-housing with new features without forking the core codebase. Modules ship as self-contained units (intercom, camera, maintenance, push notifications) installed and toggled from the admin UI. Core stays lean; the ecosystem grows around it.

### Problem Statement

Every new feature today lands in core. This blocks niche/regional features (Slovak intercom systems, building-specific camera vendors) and forces forks for one-off requirements. A module system lets the cloud operator and community ship features without bloating core, and lets each community admin enable only what they need.

## Scope

**In scope**
- Module manifest format and on-disk layout
- Module registry — discovery and load at runtime
- Lifecycle hooks: install, uninstall, app start, domain events (vote create/close, user login, post create)
- Permissions model with admin approval gate
- Named UI slots for React component injection
- Typed SDK (`@open-housing/sdk`) as the only interface from module → core
- Module-private DB tables with prefix convention; isolated migrations
- Installation flow: zip upload and GitHub release URL
- Checksum verification; optional code signing
- Per-hook crash isolation
- Reference skeleton (`intercom-2n`) to validate the architecture

**Out of scope**
- True sandboxing (vm2/isolated-vm/WASM) — Phase 2; v1 is "trusted modules only", same Node process
- Module marketplace / discovery UI — separate spec
- Pricing/licensing for paid modules — separate spec
- Hot-reload without app restart — Phase 2
- Implementation of the four reference modules (intercom, camera, maintenance, notifications) — each gets its own spec

## Approach

### Directory layout

```
modules/
  intercom-2n/
    module.json
    package.json
    dist/
      index.js          # built entry
    src/
      index.ts          # registers hooks + UI slots
      hooks/
      ui/
    migrations/         # Drizzle migrations, prefixed tables
```

Core scans `modules/` at app start, parses each `module.json`, validates, and loads `entry` if the module is enabled for the running community.

### Manifest (`module.json`)

```json
{
  "name": "intercom-2n",
  "version": "1.0.0",
  "description": "2N intercom integration",
  "author": "...",
  "entry": "dist/index.js",
  "permissions": ["db:read", "db:write", "ui:inject", "hardware:access"],
  "uiSlots": ["dashboard.widgets", "door.panel"],
  "minCoreVersion": "0.5.0",
  "checksum": "sha256:..."
}
```

`permissions` is the **declared** set. The **granted** set is whatever the admin approves on install — stored per community.

### Module entry contract

```typescript
import { defineModule, type ModuleContext } from '@open-housing/sdk';

export default defineModule({
  name: 'intercom-2n',

  async onInstall(ctx) {
    await ctx.db.runMigrations();
  },
  async onUninstall(ctx) {
    // cleanup external state; tables dropped by core
  },
  async onAppStart(ctx) {
    // warm caches, open sockets
  },

  hooks: {
    onPostCreate: async (post, ctx) => { /* ... */ },
  },

  ui: {
    'dashboard.widgets': () => import('./ui/IntercomWidget'),
    'door.panel': () => import('./ui/IntercomPanel'),
  },
});
```

### SDK shape

```typescript
// @open-housing/sdk

export interface ModuleSDK {
  db: {
    read<T>(query: ReadQuery): Promise<T[]>;                    // gated by db:read
    write(table: string, row: Record<string, unknown>): Promise<void>;  // gated by db:write, module-owned tables only
    runMigrations(): Promise<void>;
  };
  events: {
    emit(name: string, payload: unknown): void;
    on<T>(name: string, handler: (payload: T) => void): void;
  };
  ui: {
    registerSlot(slot: SlotName, component: ComponentLoader): void;     // gated by ui:inject
  };
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>;          // gated by api:external
  };
  hardware?: {
    requestDevice(spec: DeviceSpec): Promise<DeviceHandle>;             // gated by hardware:access
  };
  community: {
    current(): Promise<Community>;
    member(userId: string): Promise<Member>;
  };
  log: {
    info: (m: string, meta?: object) => void;
    warn: (m: string, meta?: object) => void;
    error: (m: string, err?: unknown) => void;
  };
}

export interface ModuleContext {
  sdk: ModuleSDK;
  module: { name: string; version: string };
  community: Community;
}

export interface ModuleDefinition {
  name: string;
  onInstall?: (ctx: ModuleContext) => Promise<void>;
  onUninstall?: (ctx: ModuleContext) => Promise<void>;
  onAppStart?: (ctx: ModuleContext) => Promise<void>;
  hooks?: Partial<DomainHooks>;
  ui?: Partial<Record<SlotName, ComponentLoader>>;
}

export type SlotName =
  | 'dashboard.widgets'
  | 'sidebar.items'
  | 'settings.tabs'
  | 'voting.before'
  | 'voting.after'
  | 'door.panel';

export interface DomainHooks {
  onVoteCreate: (vote: Vote, ctx: ModuleContext) => Promise<void>;
  onVoteClose:  (vote: Vote, ctx: ModuleContext) => Promise<void>;
  onUserLogin:  (user: User, ctx: ModuleContext) => Promise<void>;
  onPostCreate: (post: Post, ctx: ModuleContext) => Promise<void>;
}

export type ComponentLoader = () => Promise<{ default: React.ComponentType<SlotProps> }>;

export type Permission =
  | 'db:read'
  | 'db:write'
  | 'api:external'
  | 'ui:inject'
  | 'hardware:access';

export declare function defineModule(def: ModuleDefinition): ModuleDefinition;
```

Modules **must not** import from core directly. Lint rule + build-time check enforces: imports allowed only from `@open-housing/sdk` and the module's own files.

### Permission model

- Manifest declares required permissions.
- On install, admin sees a diff: "`intercom-2n` requests `db:write`, `hardware:access`. Approve?"
- Each SDK call checks the **granted** set for the running module. Missing permission → throws `PermissionDeniedError`, logged, hook skipped.
- Grants stored in `core_module_grants(community_id, module_name, permissions[], granted_at, granted_by)`.

### UI extension points

Core renders slot containers:

```tsx
<Slot name="dashboard.widgets" />
```

The slot reads the registry, lazy-imports each registered component, and renders them in deterministic order (alphabetical by module name; manifest can declare `priority: number` later if needed). Each slot wraps its children in an error boundary — a crashing module darkens its own card, never the whole page.

Available slots (v1):
- `dashboard.widgets` — cards on the dashboard
- `sidebar.items` — extra navigation entries
- `settings.tabs` — additional settings tabs
- `voting.before` / `voting.after` — wrap the voting UI
- `door.panel` — net-new top-level pages (registered via `door.panel` + a route descriptor)

### Module isolation

- Modules run in the same Node process for v1 (trusted only).
- Module code interacts with core **only** through `ModuleSDK` — enforced by:
  - `package.json` `dependencies` allowlist (no `byt-app/*` paths)
  - ESLint rule banning relative imports outside the module directory
  - Build-time AST check rejects unknown imports
- DB access goes through `sdk.db` — never raw Drizzle. SDK rewrites/validates table names against the module's prefix.

### Database conventions

- Module tables prefixed: `mod_{name}_{table}` (snake_case, name lowercased, dashes → underscores).
- Core tables are **read-only** via `sdk.db.read` with a whitelist of exposed columns.
- Each module ships its own migrations folder. Core orchestrates:
  - On install: run all pending module migrations.
  - On uninstall: drop all `mod_{name}_*` tables (after confirmation).
- Per-module migration tracking: `mod_{name}__migrations` table.

### Installation flow

```
1. Admin uploads .zip OR pastes GitHub release URL.
2. Core extracts to a staging dir.
3. Core parses module.json, validates schema, checks minCoreVersion.
4. Core verifies SHA256 checksum (and signature, if signing enabled).
5. Admin sees permission diff and version → approves or cancels.
6. On approval:
   a. Move from staging to modules/{name}/
   b. Persist grant in core_module_grants
   c. Call onInstall(ctx)
   d. Register hooks + UI slots in runtime registry
7. Module appears in UI on next request.
```

Uninstall reverses 6a–6d, calling `onUninstall(ctx)` first.

### Security

- v1 = trusted modules only; same process, no sandbox. Documented loudly.
- SHA256 checksum **required** and verified before extraction.
- Code signing optional in v1, **required** when marketplace ships (Phase 2).
- Each hook wrapped in `Promise.race([handler(), timeout(5_000)])`; timeouts logged, hook treated as no-op for that invocation.
- N consecutive failures (default 5) auto-disables the module and notifies admin.
- `api:external` calls run through `sdk.http.fetch`, which logs URL + status; future allowlist per module.
- `hardware:access` is gated and surfaces a separate consent UI before first use.

### Crash isolation

- UI: error boundary per slot; one widget crashing renders a fallback inside that card only.
- Server: every hook invocation is `try/catch` + timeout. Errors are emitted as `module.error` events; never bubble to core request handlers.
- Auto-disable on repeated failure prevents a broken module from filling logs.

## Acceptance Criteria

- [ ] `modules/` directory scanned at app start; missing or invalid `module.json` skipped with a single clear warning per module
- [ ] `module.json` validated against a published JSON schema; invalid manifests rejected with field-level errors
- [ ] `@open-housing/sdk` package published with all interfaces above and zero runtime imports from core
- [ ] All listed lifecycle hooks fire with the correct payload and a working `ModuleContext`
- [ ] All listed UI slots render registered components in deterministic order, each wrapped in an error boundary
- [ ] Permission gate blocks every SDK call lacking a matching grant; admin UI shows a clear permission diff on install
- [ ] Module-prefixed tables created on install; attempts to write to non-prefixed tables throw `PermissionDeniedError`
- [ ] Module migrations run in isolation; uninstall drops all `mod_{name}_*` tables and the migration tracking table
- [ ] Zip upload and GitHub release URL install paths both succeed end-to-end with checksum verification
- [ ] One module throwing in any hook does not crash core, other modules, or the request
- [ ] Hook timeout (default 5 s) enforced; long-running module cannot stall a vote-close request
- [ ] Reference skeleton `intercom-2n` installs, registers a `dashboard.widgets` component, declares `hardware:access`, and uninstalls cleanly
- [ ] Lint/build rules block direct imports from core into module source

## Project Context

- This is an **architecture** spec, not a feature spec — no Slovak/Czech locale work, no UI mockups beyond slot semantics.
- Depends on **RES-20260417-001** (community foundation) for `Community` and `Member` shapes exposed via `sdk.community`.
- The cloud platform (`open-resiapp-cloud`) will use this layer to gate per-tenant feature flags and ship operator-only modules.
- The four reference modules (intercom, camera, maintenance, push notifications) are illustrative here — each gets its own implementation spec once this lands.

## Notes

- Open question: should domain hooks be **observational only** or **cancellable** (return `false` to abort core action)? Lean observational for v1 — simpler, fewer foot-guns; revisit when a real cancel use case shows up.
- Open question: per-community vs global enable. Cloud needs per-community; self-hosted likely wants global. Decide the data model before the SDK ships so we don't break compat.
- True sandboxing (vm2 / isolated-vm / WASM / iframe for UI) deferred to Phase 2. Track as a separate spec when the marketplace work begins.
- User-suggested `spec_id: RES-MODULE-001` mapped to project convention `RES-20260428-002`.
- User-suggested `status: draft` mapped to schema enum value `spec`.
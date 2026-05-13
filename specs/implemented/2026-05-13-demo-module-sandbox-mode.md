---
spec_id: BYT-20260513-001
title: "Sandbox banner + manifest-driven uninstall lock (byt-app integration points for cloud's demo module)"
status: implemented
created: 2026-05-13
updated: 2026-05-13
author: Filip
owner: Filip
last_verified: 2026-05-13
project_type: node
depends_on: []
related_handoffs: ["2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md"]
tags: [modules, sandbox, white-label, cloud-onboarding]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: "2.1.1"
docs_communicated: "2026-05-13"
---

## Goal

Cloud platform's "try-it-out → go-live" flow (ORC-20260513-004) needs byt-app to boot into a clearly-marked sandbox state. Customers must see they're in demo, must not be able to disable the demo marker, and the instance must come preloaded with realistic content.

**Architectural decision (2026-05-13):** the `demo` module itself lives in the **cloud repo**, not byt-app. Cloud installs it onto each sandbox instance at provision time via the existing third-party module install pipeline (`installModule()` in `src/lib/modules/install.ts`). byt-app's job is to provide three integration points:

1. **Sandbox banner** — env-driven, rendered server-side from the locale layout when `IS_SANDBOX=true`. Lives in core because the banner must paint on first SSR pass, before any module loads.
2. **Manifest `uninstallable: false`** — new optional field on `ModuleManifest`. Cloud's demo module declares it; byt-app's uninstall path honours it.
3. **Uninstall guard** — reads the installed module's `module.json` from disk and rejects uninstall when the flag is `false`.

Self-hosted images contain none of the demo module's code. They simply ignore `IS_SANDBOX` (left unset by the user).

## Scope

**IN scope:**
- `process.env.IS_SANDBOX === "true"` read at request time in `src/components/system/InstanceStateBanners.tsx` → renders persistent banner in `<html>` via the locale layout
- `Sandbox.bannerTitle` / `Sandbox.bannerBody` i18n keys in `messages/sk.json`, `en.json`, `cs.json`
- New optional `uninstallable?: boolean` field in `ModuleManifest` (`src/lib/modules/sdk/manifest.ts`), validated and round-tripped
- Uninstall guard in `uninstallModule()` (`src/lib/modules/install.ts`) that reads `module.json` from the installed directory and throws when `uninstallable === false`
- `.env.example` updated with a "cloud-only flags" section flagging `IS_SANDBOX` as cloud-set, leave-unset for self-hosted

**OUT of scope (cloud repo's responsibility):**
- The actual `demo` module package (manifest, entry point, demo content xlsx)
- onInstall hook that seeds demo data via the byt-app importer
- Bundling / shipping the demo module image to byt-app instances
- The "go-live" provisioning sequence that triggers `installModule()` against the customer's fresh production instance (no demo installed there)

## Approach

1. Sandbox banner: extend the existing `InstanceStateBanners` server component (added for `IS_READONLY` in BYT-20260513-004) to also render a banner when `IS_SANDBOX=true`. Both banners can stack — a sandbox whose trial expired should still read "DEMO".
2. Manifest schema: add `uninstallable?: boolean` to `ModuleManifest`, validate as boolean, persist through `validateManifest()`.
3. Uninstall guard: in `uninstallModule(name)`, read `path.join(installPath, "module.json")`, parse, throw `ModuleInstallError` when `uninstallable === false`. Manifest is read from disk (not from the `coreModules` DB row) to avoid a schema migration and to honour upgrades that flip the flag.

## Acceptance Criteria

- [ ] `IS_SANDBOX=true` → DEMO banner renders on every page (login + dashboard) with correct i18n
- [ ] `IS_SANDBOX` unset or any other value → no DEMO banner, zero behavior change for self-hosted users
- [ ] `IS_SANDBOX` is read at request time (flipping the env via container restart takes effect on next request)
- [ ] `ModuleManifest.uninstallable` validates as boolean and round-trips through `validateManifest`
- [ ] Calling `uninstallModule("foo")` against an installed module whose `module.json` declares `uninstallable: false` throws `ModuleInstallError`; module remains installed
- [ ] Calling `uninstallModule` on a module whose manifest does NOT declare the flag (default) behaves as before — unchanged for all existing modules
- [ ] No `modules/demo/` directory in byt-app

## Notes

- Related handoff: `2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md` from open-resiapp-cloud
- Initial draft of this spec proposed shipping the `demo` module bundled in byt-app, gated by `IS_SANDBOX`. User feedback on 2026-05-13 corrected this: the module must live in the cloud repo so demo content can iterate independently of byt-app releases, and self-hosted images carry no demo code at all
- The cloud repo now owns: the module package, demo content curation, sandbox provisioning. byt-app owns: the banner, the manifest field, the uninstall guard

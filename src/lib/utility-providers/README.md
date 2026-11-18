# Utility providers (outages directory)

Static data per country (`sk.ts`, `cz.ts`), registry in `index.ts`. No DB, no runtime fetch.

## Yearly re-check
Once a year (or when `pnpm test:utility-providers` reports stale entries, >400 days):
open each entry's `outageUrl` on the provider's official site, confirm the URL and hotline,
update them and bump `verifiedAt`. Never copy values from third-party sites.

Not yet included (not verified on 2026-11-18): Stredoslovenská vodárenská spoločnosť,
heat suppliers (board pin only, TODO).

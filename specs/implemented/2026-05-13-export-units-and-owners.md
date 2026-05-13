---
spec_id: BYT-20260513-002
title: "Export units + owners to xlsx/csv (reverse of Easy Import)"
status: implemented
created: 2026-05-13
updated: 2026-05-13
author: Filip
owner: Filip
last_verified: 2026-05-13
project_type: node
depends_on: []
related_handoffs: ["2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md"]
tags: [export, import, easy-import, data-portability, cloud-onboarding]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: "2.1.1"
docs_communicated: "2026-05-13"
---

## Goal

Easy Import (units + owners) is implemented. There is no inverse: an admin who wants to test a fresh-start scenario, or move data between instances, has no way to extract the current state in the same format. Add an export action that produces an xlsx (and csv) file whose columns match the Easy Import schema exactly, enabling lossless round-trip.

This unlocks three use cases at once:
1. **Tester wipes and restarts**: export → reset → re-import own data
2. **Demo content distribution**: cloud team exports a master sandbox dataset once → ships as `modules/demo/data/sandbox-demo.xlsx` → demo module's `onInstall` re-imports it on every new sandbox (BYT-20260513-001 depends on this)
3. **Sandbox → production migration**: operator exports go-live customer's sandbox state → imports into freshly-provisioned production instance (covers the "premigrujeme dáta neskôr" sales promise)

## Scope

**IN scope:**
- Reuse `src/lib/import/columns.ts` as single source of truth for column order + labels
- Reuse `src/lib/import/formats/xlsx.ts` + `csv.ts` for serialisation (these already exist for the template-download feature — extend or factor out the writer)
- New "Export" button on `src/app/[locale]/(dashboard)/admin/import/page.tsx` (alongside the existing template download)
- Endpoint: `GET /api/admin/export?format=xlsx|csv` — admin-only
- Output covers: community (housing root) + entrances/blocks + units + owners + ownership shares
- Round-trip test: export → wipe → import → diff == 0 (modulo timestamps + generated ids)

**OUT of scope:**
- Exporting community posts, votes, paper-vote photos, attachments
- Exporting users that are not linked as owners
- Partial / filtered exports
- Scheduled / automatic exports

## Approach

1. Inventory `columns.ts` to confirm all importable fields have a defined `key`
2. Write a query in `src/lib/db/` that joins entities + housing_root_data + housing_unit_data + owners + ownership_shares and shapes rows to match `ColumnDef[]`
3. Drop the rows into the existing xlsx/csv writers (same writers used for template download → output is guaranteed to match importer expectations)
4. Wire up the admin page button + server action; download via streamed response
5. Round-trip integration test: seed fixture → export → drop all → import → assert state equivalence

## Acceptance Criteria

- [ ] Admin can click "Export" on `/admin/import` and download xlsx OR csv
- [ ] Downloaded file opens in Excel without column-format breakage (dates as dates, ids as text)
- [ ] Importing the downloaded file into a freshly-wiped instance reproduces the original state
- [ ] Non-admin users cannot reach the export endpoint
- [ ] Column order + headers in export === column order + headers the importer accepts (use shared `columns.ts`)

## Notes

- Related handoff: `2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md`
- This is a prerequisite for BYT-20260513-001 (demo module seeds itself from an exported xlsx, not from a hand-coded seeder)
- Decision 2026-05-13: do NOT build a programmatic demo seeder; instead build export and reuse the importer

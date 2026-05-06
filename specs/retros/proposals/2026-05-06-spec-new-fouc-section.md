---
proposal_for: /spec-new (sdd-workflow skill)
created: 2026-05-06
status: implemented
implemented: 2026-05-06
implementation_scope: local-only
implemented_in: byt-app/CLAUDE.md (### Specs)
source_retro: 2026-05-06-retro-dark-mode-toggle.md
source_findings: [3, 4]
---

## Summary

Add a conditional "FOUC / navigation-flicker" section to the `/spec-new` template. When a spec is tagged `theming`, `styling`, or otherwise touches global appearance (anything that paints across the whole app under SSR/RSC), the author must fill in three things in Approach + AC.

## Why

Findings #3 and #4 from the dark-mode-toggle retro both pointed at the same gap: SSR/RSC theming has well-known footguns (flash of unstyled content, browser-canvas flicker between RSC navs, hydration mismatch on first paint) that the current `/spec-new` template doesn't surface. The dark-mode spec was written, then implemented twice — once with `next-themes` (flickered on nav) and once with a custom cookie-based provider — and the second pass also missed `<html>`-level CSS painting and pre-paint script idempotency. None of this drift would have happened if the spec template had asked the questions up front.

## Proposed change

In `/Users/filipvnencak/web/sdd-workflow/commands/spec-new.md`, the spec body template (the one `/spec-new` instructs Claude to fill in) currently has:

```
## Approach
How this will be implemented. Written from the perspective of THIS project only.
Do not prescribe implementation details to other projects — that belongs in a handoff.
```

Augment with a conditional section, only rendered when the spec touches global appearance:

```markdown
## Approach
How this will be implemented. Written from the perspective of THIS project only.
Do not prescribe implementation details to other projects — that belongs in a handoff.

<!-- If the spec touches global appearance (theming, RTL, accessibility audit,
     locale-wide rollout), fill in the section below. Otherwise omit. -->

### FOUC / navigation flicker (only for cross-cutting visual specs)
- **Persistence channel** — where the resolved choice is stored such that the SERVER can read it on first render (cookie, URL param, header). localStorage is server-invisible and causes a flash on every RSC navigation.
- **Canvas painting** — how `<html>` itself is painted (not just `<body>`). The browser shows the html background between paints during route transitions; if it defaults to white and your body is dark, you get a flash on every nav.
- **Pre-paint resolution** — for any value that the server cannot know (OS-level `prefers-color-scheme`, viewport-derived state), how the resolved class is applied before first paint. The resolver must be idempotent — no-op when the server already painted correctly — or it reintroduces the flash on every load.
- **Verification step** — how navigation between RSC routes is exercised flash-free during testing.
```

Mirror in the AC checklist guidance (a corresponding bullet for each of the four points above).

## Risks / objections

- The section is only relevant for a small fraction of specs. Mitigated by the explicit "only for cross-cutting visual specs" guard, but still adds template noise. Could instead be a separate `/spec-new --visual` flag, but that splits the workflow.
- The list above is dark-mode-specific; RTL or accessibility audits have their own footguns. Mitigated by framing as "cross-cutting visual specs" rather than "theming specs" and letting authors adapt.

## Decision required

Apply to global sdd-workflow now (and run `/setup` to distribute) — or keep this proposal pending until a second piece of evidence accumulates. Saved here for the latter case at the user's request.

## Outcome (2026-05-06)

Applied **local-only** to `byt-app/CLAUDE.md` under `### Specs` as a four-point FOUC/flicker checklist. The global `sdd-workflow/commands/spec-new.md` skill is **not modified** — other projects sharing the workflow remain unaffected. If a second piece of evidence accumulates from another project, revisit and consider promoting the rule to the global template.

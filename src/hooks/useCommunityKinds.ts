"use client";

import { useOptionalShell } from "@/components/layout/ShellContext";
import { EMPTY_KIND_CHAIN, type CommunityKindChain } from "@/lib/shell";

// BYT-20260515-001 Phase 7: resolves the install template's kind chain so
// components can pick translation keys for the root / middle / leaf labels.
//
// BYT-20261117-002 Phase 1: no longer fetches /api/building +
// /api/templates — the dashboard server layout resolves the chain once
// (ShellData.community.kinds). Outside the dashboard layout it returns the
// empty chain.
//
// `null` slots mean the chain is shallower than expected — e.g. a
// 2-level template has no `middle`. Callers should fall back to
// HOA-flavoured legacy labels when `templateSlug` is null (pre-Phase-5
// installs).

export type { CommunityKindChain };

export function useCommunityKinds(): CommunityKindChain {
  const shell = useOptionalShell();
  return shell?.community?.kinds ?? EMPTY_KIND_CHAIN;
}

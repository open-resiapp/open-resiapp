"use client";

import { useEffect, useState } from "react";

// BYT-20260515-001 Phase 7: shared client-side helper that resolves
// the install template's kind chain. Components use it to pick
// translation keys for the root / middle / leaf labels without
// duplicating fetch logic.
//
// `null` slots mean the chain is shallower than expected — e.g. a
// 2-level template has no `middle`. Callers should fall back to
// HOA-flavoured legacy labels when `templateSlug` is null (pre-Phase-5
// installs).

export interface CommunityKindChain {
  templateSlug: string | null;
  rootKind: string | null;
  middleKind: string | null;
  leafKind: string | null;
}

const EMPTY: CommunityKindChain = {
  templateSlug: null,
  rootKind: null,
  middleKind: null,
  leafKind: null,
};

export function useCommunityKinds(): CommunityKindChain {
  const [state, setState] = useState<CommunityKindChain>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const buildingRes = await fetch("/api/building");
      if (!buildingRes.ok) return;
      const building = await buildingRes.json();
      const slug: string | null = building?.templateSlug ?? null;
      if (!slug) return;

      const tplRes = await fetch(`/api/templates?slug=${encodeURIComponent(slug)}`);
      if (!tplRes.ok) return;
      const tpl = await tplRes.json();
      const levels: string[] = Array.isArray(tpl?.import_levels)
        ? tpl.import_levels
        : [];

      if (cancelled) return;
      setState({
        templateSlug: slug,
        rootKind: levels[0] ?? tpl?.root_kind ?? null,
        // The "middle" label maps to the row above the leaf — that's
        // the level represented by the `entrances` tab in the legacy
        // HOA wizard.
        middleKind: levels.length >= 3 ? levels[levels.length - 2] : null,
        leafKind: levels.length > 0 ? levels[levels.length - 1] : null,
      });
    }

    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

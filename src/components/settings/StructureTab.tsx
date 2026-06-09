"use client";

import BuildingInfoTab from "./BuildingInfoTab";
import EntrancesTab from "./EntrancesTab";
import FlatsTab from "./FlatsTab";

interface StructureTabProps {
  canEdit: boolean;
}

/**
 * RES-20260609-002: the community structure tree (building → entrances →
 * flats) used to be three separate top-level settings tabs. They are one
 * hierarchy, so they're now stacked as sections of a single "Structure"
 * tab. Each child stays self-contained (own header, own data fetch); this
 * wrapper only owns the vertical rhythm and the dividers between levels.
 */
export default function StructureTab({ canEdit }: StructureTabProps) {
  return (
    <div className="space-y-10">
      <section>
        <BuildingInfoTab canEdit={canEdit} />
      </section>
      <section className="border-t border-gray-200 pt-10 dark:border-gray-700">
        <EntrancesTab canEdit={canEdit} />
      </section>
      <section className="border-t border-gray-200 pt-10 dark:border-gray-700">
        <FlatsTab canEdit={canEdit} />
      </section>
    </div>
  );
}

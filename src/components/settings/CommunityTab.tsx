"use client";

import BuildingInfoTab, { type BuildingInfo } from "./BuildingInfoTab";
import BrandingTab from "./BrandingTab";

interface CommunityTabProps {
  canEdit: boolean;
  initial: BuildingInfo | null;
}

/** "Spoločenstvo": community details card + logo/branding card (admins only). */
export default function CommunityTab({ canEdit, initial }: CommunityTabProps) {
  return (
    <div className="space-y-6">
      <BuildingInfoTab canEdit={canEdit} initial={initial} />
      {canEdit ? <BrandingTab canEdit={canEdit} /> : null}
    </div>
  );
}

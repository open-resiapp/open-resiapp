import type { ComponentType } from "react";

export const SLOT_NAMES = [
  "dashboard.widgets",
  "sidebar.items",
  "settings.tabs",
  "voting.before",
  "voting.after",
  "door.panel",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

export interface SlotProps {
  community: { id: string; name: string };
  member: { id: string; role: string } | null;
}

export type ComponentLoader = () => Promise<{
  default: ComponentType<SlotProps>;
}>;

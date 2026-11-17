// Presentation-only templates for the "new voting" flow
// (BYT-20261117-002 Phase 5). A template pre-fills the voting title, the
// items and each item's quorum type. It never changes what the API accepts:
// the quorum is always resolved through getAvailableQuorumTypes() for the
// community's country + voting type (see resolveQuorum).
//
// docs/domain/voting.md states no quorum for any of these cases, so every
// template asks for the default majority (simple_all) and flags the item with
// `confirmQuorum` — the chairman sees the selector and decides. We do not
// guess law here.
import type { IconName } from "@/components/ui";
import type { QuorumType } from "@/types";

export type TemplateId = "accounts" | "budget" | "repair" | "elections" | "custom";

export interface VotingTemplate {
  id: TemplateId;
  icon: IconName;
  /** Preferred quorum for every item; falls back to the first available one. */
  preferredQuorum: QuorumType;
  /** Show a "decide the majority" hint on the items (law not stated in the domain doc). */
  confirmQuorum: boolean;
  /** Keys under VotingWizard.templates.<id>.items.<key>.{title,text}. */
  itemKeys: string[];
}

export const VOTING_TEMPLATES: readonly VotingTemplate[] = [
  { id: "accounts", icon: "file", preferredQuorum: "simple_all", confirmQuorum: true, itemKeys: ["1"] },
  { id: "budget", icon: "wallet", preferredQuorum: "simple_all", confirmQuorum: true, itemKeys: ["1", "2"] },
  { id: "repair", icon: "building", preferredQuorum: "simple_all", confirmQuorum: true, itemKeys: ["1"] },
  { id: "elections", icon: "users", preferredQuorum: "simple_all", confirmQuorum: true, itemKeys: ["1"] },
  { id: "custom", icon: "edit", preferredQuorum: "simple_all", confirmQuorum: false, itemKeys: [] },
] as const;

/** Preferred quorum if available, else the first available type. */
export function resolveQuorum(
  preferred: string,
  available: readonly QuorumType[]
): QuorumType {
  if ((available as readonly string[]).includes(preferred)) return preferred as QuorumType;
  return available[0] ?? "simple_all";
}

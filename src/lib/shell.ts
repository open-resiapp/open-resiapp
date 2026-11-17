// Client-safe types for the dashboard shell (BYT-20261117-002 Phase 1).
// The server layout resolves a `ShellData` once per request in
// src/lib/shell.server.ts and hands it to <ShellProvider>. Everything here
// must stay plain JSON (no Date, Map, Set, BigInt) — it crosses the RSC
// boundary as a prop.

import type { NavAudience, NavBadgeKey } from "@/lib/navigation";
import type { BoardMemberRole, UserRole, UserStatus } from "@/types";

export interface CommunityKindChain {
  templateSlug: string | null;
  rootKind: string | null;
  middleKind: string | null;
  leafKind: string | null;
}

export const EMPTY_KIND_CHAIN: CommunityKindChain = {
  templateSlug: null,
  rootKind: null,
  middleKind: null,
  leafKind: null,
};

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Active board_members roles at the community root. */
  boardRoles: BoardMemberRole[];
  /** Unit entity ids where the user holds an active membership. */
  unitIds: string[];
}

export interface ShellCommunity {
  id: string;
  name: string;
  /** Raw entities.data.template_slug (may be a legacy kind slug or null). */
  templateSlug: string | null;
  /** Slug guaranteed to have a `Templates.<slug>.name` message, or null. */
  displayTemplateSlug: string | null;
  kinds: CommunityKindChain;
}

export interface ShellEntityOption {
  id: string;
  name: string;
  kind: string;
}

export interface ShellShareSumViolation {
  unitEntityId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

export interface ShellData {
  user: ShellUser;
  /** Navigation set derived from role + board membership. */
  audience: NavAudience;
  community: ShellCommunity | null;
  branding: {
    /** Versioned logo URL (cache-busted), or null when no logo is set. */
    logoUrl: string | null;
  };
  enabledModules: string[];
  entities: {
    /** Roots the user can switch between (switcher hidden when ≤ 1). */
    options: ShellEntityOption[];
    currentId: string | null;
  };
  consent: {
    needsConsent: boolean;
    policyVersion: string;
  };
  /** Admin (manageSettings) only; null for everyone else. */
  onboarding: { complete: boolean } | null;
  /** Admin (manageUsers) only; empty for everyone else. */
  shareSumViolations: ShellShareSumViolation[];
  /** Optional nav badge counts; a missing key means "no badge". */
  badges: Partial<Record<NavBadgeKey, number>>;
}

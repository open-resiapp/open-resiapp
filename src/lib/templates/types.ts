// BYT-20260515-001 Phase 4: template system types.
//
// A template encodes the shape of a community kind: which entity kinds
// it uses, what tree levels the import wizard offers, what voting
// method it defaults to, and which roles the bootstrap flow seeds.
//
// Templates ship as JSON files in src/lib/templates/{slug}.json so
// adding template 21 = drop a JSON file + add Templates.{slug}.* keys.
// No code change required for new templates.

import type { CanonicalVotingMethod } from "@/lib/voting-method";

export interface TemplateStarterNode {
  /** entity_kinds.slug for this node. Must be registered in the catalog. */
  kind: string;
  /** i18n key resolved at instantiation, e.g. "Templates.garden.sampleCommunityName". */
  name_key: string;
  children?: TemplateStarterNode[];
}

export interface Template {
  /** Stable identifier — written to INSTALL_TEMPLATE env, never localised. */
  slug: string;

  /** Translation key resolved by the UI / setup.sh prompt. */
  display_name_key: string;
  description_key: string;

  /**
   * Broad UX grouping for the picker dropdown. Categories are stable
   * strings (matched against translation keys Templates.Categories.*).
   */
  category: "residential" | "land" | "commercial" | "civic" | "custom";

  /** entity_kinds.slug seeded at the community root. */
  root_kind: string;

  /** Default voting_method written to entities.data on the root. */
  default_voting_method: CanonicalVotingMethod;

  /** Membership roles auto-created during bootstrap (chairman, member, …). */
  default_roles: string[];

  /**
   * Starter tree seeded at first boot when the template is selected.
   * Single-element array for v1 (one community per instance); the
   * shape is forward-compatible for multi-root instances later.
   */
  starter_tree: TemplateStarterNode[];

  /**
   * Tree levels the import wizard offers as kind pickers, in order.
   * Each entry is an entity_kinds.slug. Empty for `custom` template.
   */
  import_levels: string[];

  /**
   * When true, the template ships with statutory voting/quorum
   * defaults that should be vetted by local legal counsel before
   * production rollout. Surfaced in admin UI as a warning badge.
   */
  legal_review_required?: boolean;
  /** URL to the relevant statute / domain documentation, if any. */
  notes_url?: string;
}

export interface TemplateSummary {
  slug: string;
  display_name_key: string;
  description_key: string;
  category: Template["category"];
  default_voting_method: CanonicalVotingMethod;
  legal_review_required: boolean;
}

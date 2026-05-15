// BYT-20260515-001 Phase 1a: per-instance kind catalog.
// Client-safe types + slug constants. Server-only operations
// (DB seed, lookup against entity_kinds table) live in
// registry.server.ts.

export const CANONICAL_KIND_SLUGS = [
  // Residential & housing
  "community",
  "building",
  "entrance",
  "unit",
  "house",
  "street",
  "cottage",
  "mobile_home_pad",
  // Land & nature
  "garden_section",
  "plot",
  "parcel_group",
  "parcel",
  "apiary_zone",
  "hive_owner",
  "hunting_district",
  "hunter",
  "pond",
  "license_holder",
  // Commercial & shared
  "garage_block",
  "garage",
  "storage_row",
  "storage_unit",
  "floor",
  "office_suite",
  "coworking_zone",
  "desk",
  "industrial_block",
  "tenant_lot",
  "dock",
  "mooring",
  // Social & civic
  "club_section",
  "member_locker",
  "class",
  "parent_seat",
  "congregation_group",
  "member_household",
  "cemetery_section",
  "grave_plot",
  // Generic fallback
  "generic_group",
] as const;

export type CanonicalKindSlug = (typeof CANONICAL_KIND_SLUGS)[number];

// Legacy enum (entityKindEnum in src/db/schema.ts) → new slug.
// Used by Phase 1b backfill to populate entity_kinds + rewrite
// entities.kind from enum to text FK. Once Phase 1b lands, the
// enum disappears and this map becomes a one-off migration artifact.
export const LEGACY_KIND_TO_SLUG = {
  housing_community: "community",
  housing_block: "building",
  housing_entrance: "entrance",
  housing_unit: "unit",
  generic_group: "generic_group",
} as const satisfies Record<string, CanonicalKindSlug>;

export type LegacyKind = keyof typeof LEGACY_KIND_TO_SLUG;

export interface KindCatalogRow {
  slug: string;
  displayNameKey: string;
  icon: string | null;
  allowsMembers: boolean;
  votable: boolean;
  allowedParentKinds: string[];
  dataSchema: Record<string, unknown>;
  sortOrder: number;
}

// Default catalog seed for the `hoa` template. Other templates ship
// their own seed arrays under src/lib/templates/{slug}.json once
// the template system lands in Phase 4.
export const HOA_CATALOG_SEED: KindCatalogRow[] = [
  {
    slug: "community",
    displayNameKey: "Kinds.hoa.community",
    icon: "building-2",
    allowsMembers: false,
    votable: true,
    allowedParentKinds: [],
    dataSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        ico: { type: "string" },
        voting_method: { enum: ["per_share", "per_flat", "per_area"] },
        country: { enum: ["sk", "cz"] },
        governance_model: {
          enum: ["chairman_council", "committee", "chairman_only"],
        },
      },
      required: ["address"],
    },
    sortOrder: 10,
  },
  {
    slug: "building",
    displayNameKey: "Kinds.hoa.building",
    icon: "building",
    allowsMembers: false,
    votable: false,
    allowedParentKinds: ["community"],
    dataSchema: { type: "object" },
    sortOrder: 20,
  },
  {
    slug: "entrance",
    displayNameKey: "Kinds.hoa.entrance",
    icon: "door-open",
    allowsMembers: false,
    votable: true,
    allowedParentKinds: ["community", "building"],
    dataSchema: { type: "object" },
    sortOrder: 30,
  },
  {
    slug: "unit",
    displayNameKey: "Kinds.hoa.unit",
    icon: "home",
    allowsMembers: true,
    votable: false,
    allowedParentKinds: ["entrance", "building", "community"],
    dataSchema: {
      type: "object",
      properties: {
        flat_number: { type: "string" },
        floor: { type: "integer" },
        share_numerator: { type: "integer" },
        share_denominator: { type: "integer" },
        area_m2: { type: "number" },
      },
      required: ["flat_number", "share_numerator", "share_denominator"],
    },
    sortOrder: 40,
  },
  {
    slug: "generic_group",
    displayNameKey: "Kinds.hoa.genericGroup",
    icon: "folder",
    allowsMembers: false,
    votable: false,
    allowedParentKinds: [
      "community",
      "building",
      "entrance",
      "unit",
      "generic_group",
    ],
    dataSchema: { type: "object" },
    sortOrder: 100,
  },
];

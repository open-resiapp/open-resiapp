-- BYT-20260515-001 Phase 1b: seed the per-instance entity_kinds
-- catalog with the five canonical HOA kinds. Mirrors the existing
-- legacy enum values so Phase 1c can flip entities.kind from
-- entityKindEnum to a text FK without a backfill window.
--
-- Idempotent: ON CONFLICT DO NOTHING so this is safe to re-run on
-- re-deploys and on fresh installs where the catalog was seeded by
-- application bootstrap.

INSERT INTO entity_kinds (
  slug, display_name_key, icon, allows_members, votable,
  allowed_parent_kinds, data_schema, sort_order
)
VALUES
  (
    'community',
    'Kinds.hoa.community',
    'building-2',
    false,
    true,
    '{}'::text[],
    '{
      "type": "object",
      "properties": {
        "address": {"type": "string"},
        "ico": {"type": "string"},
        "voting_method": {"enum": ["per_share", "per_flat", "per_area"]},
        "country": {"enum": ["sk", "cz"]},
        "governance_model": {"enum": ["chairman_council", "committee", "chairman_only"]}
      },
      "required": ["address"]
    }'::jsonb,
    10
  ),
  (
    'building',
    'Kinds.hoa.building',
    'building',
    false,
    false,
    ARRAY['community']::text[],
    '{"type": "object"}'::jsonb,
    20
  ),
  (
    'entrance',
    'Kinds.hoa.entrance',
    'door-open',
    false,
    true,
    ARRAY['community', 'building']::text[],
    '{"type": "object"}'::jsonb,
    30
  ),
  (
    'unit',
    'Kinds.hoa.unit',
    'home',
    true,
    false,
    ARRAY['entrance', 'building', 'community']::text[],
    '{
      "type": "object",
      "properties": {
        "flat_number": {"type": "string"},
        "floor": {"type": "integer"},
        "share_numerator": {"type": "integer"},
        "share_denominator": {"type": "integer"},
        "area_m2": {"type": "number"}
      },
      "required": ["flat_number", "share_numerator", "share_denominator"]
    }'::jsonb,
    40
  ),
  (
    'generic_group',
    'Kinds.hoa.genericGroup',
    'folder',
    false,
    false,
    ARRAY['community', 'building', 'entrance', 'unit', 'generic_group']::text[],
    '{"type": "object"}'::jsonb,
    100
  )
ON CONFLICT (slug) DO NOTHING;

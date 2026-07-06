-- Technical-audit (revízie) catalog. FPÚO okruh — statutory inspections
-- are funded from the fond prevádzky, údržby a opráv and post Dr 472.
-- BYT-20260512-002 Phase 3 (technical-audit link).
INSERT INTO "mod_accounting_service_categories" ("country", "slug", "okruh", "name_key", "sort_order") VALUES
  ('sk', 'REVIZIA_ELECTRICAL', 'fpuo', 'REVIZIA_ELECTRICAL', 200),
  ('sk', 'REVIZIA_GAS', 'fpuo', 'REVIZIA_GAS', 210),
  ('sk', 'REVIZIA_LIFT', 'fpuo', 'REVIZIA_LIFT', 220),
  ('sk', 'REVIZIA_CHIMNEY', 'fpuo', 'REVIZIA_CHIMNEY', 230),
  ('sk', 'REVIZIA_FIRE', 'fpuo', 'REVIZIA_FIRE', 240),
  ('sk', 'REVIZIA_LIGHTNING', 'fpuo', 'REVIZIA_LIGHTNING', 250),
  ('cz', 'REVIZIA_ELECTRICAL', 'fpuo', 'REVIZIA_ELECTRICAL', 200),
  ('cz', 'REVIZIA_GAS', 'fpuo', 'REVIZIA_GAS', 210),
  ('cz', 'REVIZIA_LIFT', 'fpuo', 'REVIZIA_LIFT', 220),
  ('cz', 'REVIZIA_CHIMNEY', 'fpuo', 'REVIZIA_CHIMNEY', 230),
  ('cz', 'REVIZIA_FIRE', 'fpuo', 'REVIZIA_FIRE', 240),
  ('cz', 'REVIZIA_LIGHTNING', 'fpuo', 'REVIZIA_LIGHTNING', 250)
ON CONFLICT ("country", "slug") DO NOTHING;

-- Hand-written data migration (BYT-20260512-002 Phase 1).
-- Seeds the SK reference catalogs the accounting module reads at runtime:
-- chart of accounts (Phase 1 subset per Opatrenie MF SR č. MF/24342/2007-74)
-- and the FULL SK service-category enumeration (project rule: complete
-- catalog lands before any bootstrap path references it).
-- Source of truth mirrored in modules/accounting/src/seeds/{coa-sk,service-categories-sk}.ts
-- — any change there requires a new migration.
-- Idempotent via ON CONFLICT DO NOTHING on the catalog unique indexes.

INSERT INTO "mod_accounting_accounts" ("country", "code", "name", "kind") VALUES
  ('sk', '211', 'Pokladnica', 'asset'),
  ('sk', '221', 'Bankové účty', 'asset'),
  ('sk', '311.100', 'Pohľadávky voči vlastníkom — fond prevádzky, údržby a opráv', 'asset'),
  ('sk', '311.200', 'Pohľadávky voči vlastníkom — zálohy na služby', 'asset'),
  ('sk', '378', 'Iné pohľadávky', 'asset'),
  ('sk', '379', 'Iné záväzky', 'liability'),
  ('sk', '472', 'Záväzky z fondu prevádzky, údržby a opráv', 'liability'),
  ('sk', '478', 'Záväzky zo záloh na služby a plnenia', 'liability'),
  ('sk', '428', 'Nevysporiadaný výsledok hospodárenia minulých rokov', 'equity')
ON CONFLICT ("country", "code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "mod_accounting_service_categories" ("country", "slug", "okruh", "name_key", "sort_order") VALUES
  ('sk', 'FPUO', 'fpuo', 'FPUO', 0),
  ('sk', 'SVC_HEAT', 'svc', 'SVC_HEAT', 10),
  ('sk', 'SVC_WATER_COLD', 'svc', 'SVC_WATER_COLD', 20),
  ('sk', 'SVC_WATER_HOT', 'svc', 'SVC_WATER_HOT', 30),
  ('sk', 'SVC_ELECTRICITY_COMMON', 'svc', 'SVC_ELECTRICITY_COMMON', 40),
  ('sk', 'SVC_LIFT', 'svc', 'SVC_LIFT', 50),
  ('sk', 'SVC_CLEANING', 'svc', 'SVC_CLEANING', 60),
  ('sk', 'SVC_INTERNET', 'svc', 'SVC_INTERNET', 70),
  ('sk', 'SVC_OTHER', 'svc', 'SVC_OTHER', 99)
ON CONFLICT ("country", "slug") DO NOTHING;

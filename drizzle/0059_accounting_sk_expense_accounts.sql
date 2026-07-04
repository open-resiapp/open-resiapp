-- Hand-written data migration (BYT-20260512-002 Phase 3).
-- Extends the SK chart of accounts with the expense-side subset:
-- 321 Dodávatelia + 5xx náklady accounts the expense booking engine
-- posts to (Opatrenie MF SR č. MF/24342/2007-74). FPÚO čerpanie debits
-- 472 directly and needs no new account.
-- Source of truth mirrored in modules/accounting/src/seeds/coa-sk.ts —
-- any change there requires a new migration.
-- Idempotent via ON CONFLICT DO NOTHING.

INSERT INTO "mod_accounting_accounts" ("country", "code", "name", "kind") VALUES
  ('sk', '321', 'Dodávatelia', 'liability'),
  ('sk', '502', 'Spotreba energie', 'expense'),
  ('sk', '511', 'Opravy a udržiavanie', 'expense'),
  ('sk', '518', 'Ostatné služby', 'expense'),
  ('sk', '549', 'Iné ostatné náklady', 'expense')
ON CONFLICT ("country", "code") DO NOTHING;

-- Hand-written migration (BYT-20260512-002 Phase 1).
-- Enforces the core accounting invariant at the database level:
-- every mod_accounting_journal_entries row must have at least one line
-- and Σ debit_cents = Σ credit_cents across its lines at COMMIT time.
-- A row-level CHECK cannot span rows, so this is a deferred constraint
-- trigger: the posting engine writes entry + lines in one transaction
-- and the balance is verified once, at commit.

CREATE OR REPLACE FUNCTION mod_accounting_assert_entry_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_debits bigint;
  v_credits bigint;
  v_count int;
BEGIN
  -- Entry deleted in the same transaction (cascade) → nothing to assert.
  IF NOT EXISTS (SELECT 1 FROM mod_accounting_journal_entries WHERE id = p_entry_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0), COUNT(*)
    INTO v_debits, v_credits, v_count
    FROM mod_accounting_journal_lines
   WHERE journal_entry_id = p_entry_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'journal entry % has no lines', p_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits % <> credits %',
      p_entry_id, v_debits, v_credits
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION mod_accounting_journal_lines_balance_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mod_accounting_assert_entry_balanced(
    COALESCE(NEW.journal_entry_id, OLD.journal_entry_id)
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION mod_accounting_journal_entries_balance_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mod_accounting_assert_entry_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Fires when lines change (insert/update/delete) — catches edits that
-- would unbalance an existing entry.
CREATE CONSTRAINT TRIGGER mod_accounting_journal_lines_balance
  AFTER INSERT OR UPDATE OR DELETE ON mod_accounting_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION mod_accounting_journal_lines_balance_trg();
--> statement-breakpoint

-- Fires on entry insert — catches an entry committed with zero lines
-- (the lines trigger never fires in that case).
CREATE CONSTRAINT TRIGGER mod_accounting_journal_entries_balance
  AFTER INSERT ON mod_accounting_journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION mod_accounting_journal_entries_balance_trg();

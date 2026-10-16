-- Bank loans. Same tables as 0023 (a bank loan is a `loans` row with lender_kind = 'BANK'); this
-- adds what only a bank loan needs: the cooldown flag, the interest paid on repayment and the
-- rate that was suggested at that moment. Interest is not a balance on its own: it is part of the
-- LOAN_REPAYMENT transaction total, which leaves the game (bank). Existing rows get neutral values.
ALTER TABLE loans ADD COLUMN cooldown_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_acknowledged IN (0, 1));

ALTER TABLE loan_repayments ADD COLUMN interest_amount INTEGER NOT NULL DEFAULT 0 CHECK (interest_amount >= 0);
ALTER TABLE loan_repayments ADD COLUMN interest_rate_percent INTEGER CHECK (interest_rate_percent IS NULL OR interest_rate_percent IN (0, 10, 20));
ALTER TABLE loan_repayments ADD COLUMN suggested_rate_percent INTEGER CHECK (suggested_rate_percent IS NULL OR suggested_rate_percent IN (0, 10, 20));

-- One active bank loan per player; a new one is allowed once the previous is REPAID or WRITTEN_OFF.
-- Player loans are not covered.
CREATE UNIQUE INDEX loans_one_active_bank_loan ON loans(borrower_player_id) WHERE lender_kind = 'BANK' AND state = 'ACTIVE';

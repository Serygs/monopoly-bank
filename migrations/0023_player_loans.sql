-- Player and bank loans. Every step is an explicit transaction (LOAN_ISSUE, LOAN_REPAYMENT, whose
-- types 0022 already allows, so `transactions` is not rebuilt). `loans` only remembers who owes
-- how much; balances still move only through transactions. Loans are offered as a payment request
-- of kind LOAN.
ALTER TABLE payment_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'PAYMENT' CHECK (kind IN ('PAYMENT', 'LOAN'));

-- The id is the id of the LOAN_ISSUE transaction that created it, so a retried command can never
-- create two. Links to transactions are NO ACTION (checked when the statement ends) so deleting a
-- whole game works whatever order SQLite cascades through its tables (see 0022).
CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  lender_kind TEXT NOT NULL DEFAULT 'PLAYER' CHECK (lender_kind IN ('PLAYER', 'BANK')),
  lender_player_id TEXT,
  borrower_player_id TEXT NOT NULL,
  principal INTEGER NOT NULL CHECK (principal > 0),
  repaid_amount INTEGER NOT NULL DEFAULT 0 CHECK (repaid_amount >= 0 AND repaid_amount <= principal),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REPAID', 'WRITTEN_OFF')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  UNIQUE (id, game_id),
  CHECK ((lender_kind = 'PLAYER') = (lender_player_id IS NOT NULL)),
  CHECK (lender_player_id IS NULL OR lender_player_id <> borrower_player_id),
  CHECK ((state = 'REPAID') = (repaid_amount = principal)),
  CHECK ((state = 'ACTIVE') = (closed_at IS NULL)),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (borrower_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (lender_player_id, game_id) REFERENCES players(id, game_id) ON DELETE RESTRICT,
  FOREIGN KEY (id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION
);

CREATE INDEX loans_by_game_state ON loans(game_id, state);
CREATE INDEX loans_by_borrower_state ON loans(borrower_player_id, state);

CREATE TABLE loan_repayments (
  transaction_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  loan_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  FOREIGN KEY (transaction_id, game_id) REFERENCES transactions(id, game_id) ON DELETE NO ACTION,
  FOREIGN KEY (loan_id, game_id) REFERENCES loans(id, game_id) ON DELETE CASCADE
);

CREATE INDEX loan_repayments_by_loan_id ON loan_repayments(loan_id);

-- Optional house rules are chosen when the lobby is created and never edited afterwards, like
-- payment_mode. Every existing game keeps all rules off.
-- Expand-only: nullable or defaulted columns, no existing row changes.
ALTER TABLE games ADD COLUMN rule_double_go INTEGER NOT NULL DEFAULT 0 CHECK (rule_double_go IN (0, 1));
ALTER TABLE games ADD COLUMN rule_player_loans INTEGER NOT NULL DEFAULT 0 CHECK (rule_player_loans IN (0, 1));
ALTER TABLE games ADD COLUMN rule_bank_loans INTEGER NOT NULL DEFAULT 0 CHECK (rule_bank_loans IN (0, 1));
ALTER TABLE games ADD COLUMN rule_jackpot INTEGER NOT NULL DEFAULT 0 CHECK (rule_jackpot IN (0, 1));
ALTER TABLE games ADD COLUMN rule_auctions INTEGER NOT NULL DEFAULT 0 CHECK (rule_auctions IN (0, 1));

-- JSON snapshot of the amounts derived from the starting balance when the game was created
-- (money unit, taxes, jail fine, loan and auction limits). NULL for games created before it existed.
ALTER TABLE games ADD COLUMN settings_snapshot TEXT CHECK (settings_snapshot IS NULL OR json_valid(settings_snapshot));

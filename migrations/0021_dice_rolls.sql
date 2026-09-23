-- The last dice total is persisted only so utility rent (dice total times the
-- board multiplier) can be settled server-side. It is a receipt of the roll, not
-- board position or turn order: D1 stores no token, no turn pointer, no movement.
ALTER TABLE players ADD COLUMN last_roll_total INTEGER CHECK (last_roll_total IS NULL OR last_roll_total BETWEEN 2 AND 12);
ALTER TABLE players ADD COLUMN last_roll_at TEXT;

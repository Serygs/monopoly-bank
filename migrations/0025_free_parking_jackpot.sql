-- Free Parking jackpot. The pot is the one game-level balance, scoped to the freeParkingJackpot
-- house rule: it holds only what players paid in and is emptied when someone collects it. It
-- changes only in the same batch as a TO_JACKPOT or JACKPOT_PAYOUT transaction (both types are
-- already allowed by the transactions CHECK since 0022). Existing games start at 0.
ALTER TABLE games ADD COLUMN jackpot_balance INTEGER NOT NULL DEFAULT 0 CHECK (jackpot_balance >= 0);

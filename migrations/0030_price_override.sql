-- Board purchases: a buyer may pay a price other than the list price (an agreed deal at the table).
-- The flag only marks such a PROPERTY_PURCHASE so the ledger can show it; the amount is the price
-- actually paid. ADD COLUMN needs no table rebuild.
ALTER TABLE transactions ADD COLUMN price_overridden INTEGER NOT NULL DEFAULT 0
  CHECK (price_overridden IN (0, 1) AND (price_overridden = 0 OR type = 'PROPERTY_PURCHASE'));

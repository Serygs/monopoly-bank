ALTER TABLE games ADD COLUMN currency TEXT NOT NULL DEFAULT 'K' CHECK (currency IN ('USD', 'EUR', 'UAH', 'K'));

-- A tracked listing keeps its own price and currency; the goal target is that price in
-- the goal's currency. Refreshing a listing never changes the goal's currency.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS source_currency char(3);

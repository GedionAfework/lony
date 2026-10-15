-- Persist product/source URL for Plan goals so prices can be re-checked later.
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS last_seen_price numeric(18, 2),
  ADD COLUMN IF NOT EXISTS last_price_checked_at timestamptz;

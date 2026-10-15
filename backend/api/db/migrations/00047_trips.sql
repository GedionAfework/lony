-- Trip / event spend envelopes with optional cashflow tagging.

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  currency_code char(3) NOT NULL,
  limit_amount numeric(18, 2) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  CHECK (limit_amount > 0),
  CHECK (ends_on >= starts_on),
  CHECK (ends_on <= starts_on + 366)
);

CREATE INDEX IF NOT EXISTS trips_user_dates_idx
  ON trips (user_id, starts_on DESC, ends_on DESC);

ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cashflow_entries_trip_idx
  ON cashflow_entries (user_id, trip_id)
  WHERE trip_id IS NOT NULL;

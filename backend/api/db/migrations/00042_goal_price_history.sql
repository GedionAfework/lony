-- Track scraped listing prices over time so Plan can show ups/downs.
CREATE TABLE IF NOT EXISTS goal_price_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    price numeric(18, 2) NOT NULL,
    currency_code text NOT NULL,
    source_url text,
    direction text NOT NULL DEFAULT 'same',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goal_price_history_goal_created_idx
    ON goal_price_history (goal_id, created_at DESC);

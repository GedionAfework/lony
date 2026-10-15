-- Bond model: friendships form when a loan/split is accepted; interaction builds closeness.
-- No separate “friend request” product surface — pending rows may still exist historically.

ALTER TABLE friendships
  ADD COLUMN IF NOT EXISTS interaction_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interacted_at timestamptz;

-- Seed interaction from shared peer loans (each loan counts once toward the pair).
UPDATE friendships f
SET
  interaction_count = GREATEST(
    f.interaction_count,
    COALESCE((
      SELECT COUNT(*)::int
      FROM loans l
      WHERE l.borrower_id <> l.lender_id
        AND (
          (l.borrower_id = f.user_low_id AND l.lender_id = f.user_high_id)
          OR (l.borrower_id = f.user_high_id AND l.lender_id = f.user_low_id)
        )
    ), 0)
  ),
  last_interacted_at = COALESCE(
    f.last_interacted_at,
    (
      SELECT MAX(COALESCE(l.accepted_at, l.created_at))
      FROM loans l
      WHERE l.borrower_id <> l.lender_id
        AND (
          (l.borrower_id = f.user_low_id AND l.lender_id = f.user_high_id)
          OR (l.borrower_id = f.user_high_id AND l.lender_id = f.user_low_id)
        )
    )
  ),
  updated_at = now()
WHERE f.status = 'accepted';

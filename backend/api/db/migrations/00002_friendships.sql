CREATE TABLE friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id),
  addressee_id uuid NOT NULL REFERENCES users(id),
  user_low_id uuid NOT NULL,
  user_high_id uuid NOT NULL,
  status varchar(32) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  blocked_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id),
  CHECK (user_low_id <> user_high_id),
  CHECK (status IN ('pending', 'accepted', 'rejected', 'removed', 'blocked'))
);

CREATE UNIQUE INDEX friendships_pair_key ON friendships (user_low_id, user_high_id);
CREATE INDEX friendships_requester_status_idx ON friendships (requester_id, status);
CREATE INDEX friendships_addressee_status_idx ON friendships (addressee_id, status);

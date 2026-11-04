-- Chat sync: a message's updated_at moves on any change the other person must see
-- (new, reaction, deletion, moved into a merged thread), so clients can poll
-- "what changed since" instead of only "what is newer".
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE messages SET updated_at = COALESCE(deleted_at, created_at) WHERE updated_at IS NULL;
ALTER TABLE messages ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE messages ALTER COLUMN updated_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_updated_idx ON messages (conversation_id, updated_at);

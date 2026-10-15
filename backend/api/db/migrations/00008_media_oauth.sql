-- +goose Up
-- Media objects for avatars, repayment proofs, and shared uploads.
CREATE TABLE IF NOT EXISTS media_objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    object_key text NOT NULL UNIQUE,
    kind varchar(32) NOT NULL,
    mime_type text,
    original_name text,
    byte_size integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_objects_owner_idx ON media_objects (owner_user_id);

ALTER TABLE repayments
    DROP CONSTRAINT IF EXISTS repayments_proof_attachment_id_fkey;

ALTER TABLE repayments
    ADD CONSTRAINT repayments_proof_attachment_id_fkey
    FOREIGN KEY (proof_attachment_id) REFERENCES media_objects(id);

-- OAuth identities (Google, Telegram). WhatsApp has no consumer Sign-In OAuth.
CREATE TABLE IF NOT EXISTS user_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    provider varchar(32) NOT NULL,
    subject text NOT NULL,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities (user_id);

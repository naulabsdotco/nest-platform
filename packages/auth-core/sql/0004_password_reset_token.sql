CREATE TABLE password_reset_token (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id uuid NOT NULL REFERENCES subject (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    requested_ip inet
);

CREATE UNIQUE INDEX password_reset_token_token_hash_key ON password_reset_token (token_hash);
CREATE INDEX password_reset_token_live_subject_idx ON password_reset_token (subject_id) WHERE consumed_at IS NULL;

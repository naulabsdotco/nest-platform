CREATE TABLE refresh_token (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id uuid NOT NULL REFERENCES subject (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    family_id uuid NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    user_agent text,
    ip inet
);

CREATE UNIQUE INDEX refresh_token_token_hash_key ON refresh_token (token_hash);
CREATE INDEX refresh_token_family_id_idx ON refresh_token (family_id);
CREATE INDEX refresh_token_live_subject_idx ON refresh_token (subject_id) WHERE revoked_at IS NULL;

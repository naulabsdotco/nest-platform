CREATE TABLE login_attempt (
    at timestamptz NOT NULL DEFAULT now(),
    email_hash text NOT NULL,
    ip inet NOT NULL,
    outcome text NOT NULL,
    reason text
);

CREATE INDEX login_attempt_email_hash_at_idx ON login_attempt (email_hash, at);

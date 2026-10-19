CREATE TABLE subject_credential (
    subject_id uuid PRIMARY KEY REFERENCES subject (id) ON DELETE CASCADE,
    algo text NOT NULL DEFAULT 'argon2id' CHECK (algo IN ('argon2id', 'bcrypt')),
    hash text NOT NULL,
    source_updated_at timestamptz,
    failed_count integer NOT NULL DEFAULT 0,
    locked_until timestamptz
);

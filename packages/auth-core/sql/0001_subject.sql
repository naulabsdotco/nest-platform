CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE subject (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email citext UNIQUE NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

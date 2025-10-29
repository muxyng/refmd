ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS archived_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archived_parent_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_owner_active
    ON documents(owner_id)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_owner_archived
    ON documents(owner_id)
    WHERE archived_at IS NOT NULL;

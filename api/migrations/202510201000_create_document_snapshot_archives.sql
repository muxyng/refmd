CREATE TABLE IF NOT EXISTS document_snapshot_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INT NOT NULL,
  snapshot BYTEA NOT NULL,
  label TEXT NOT NULL,
  notes TEXT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  byte_size BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(document_id, version),
  CHECK (kind <> '')
);

CREATE INDEX IF NOT EXISTS idx_document_snapshot_archives_doc_created
  ON document_snapshot_archives(document_id, created_at DESC);

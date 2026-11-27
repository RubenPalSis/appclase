CREATE TABLE teacher_storage_connections (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id),
  origin TEXT NOT NULL,
  bucket TEXT NOT NULL,
  credential TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  UNIQUE (origin,bucket)
);

CREATE UNIQUE INDEX teacher_storage_active ON teacher_storage_connections(teacher_id) WHERE active=1;
ALTER TABLE storage_reservations ADD COLUMN connection_id TEXT REFERENCES teacher_storage_connections(id);
ALTER TABLE storage_reservations ADD COLUMN quota_scope TEXT NOT NULL DEFAULT 'global';
CREATE INDEX storage_quota_scope ON storage_reservations(quota_scope);

CREATE TABLE storage_reservations (
  object_key TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK (bytes > 0)
);

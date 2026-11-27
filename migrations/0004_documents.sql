CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 16777216),
  created INTEGER NOT NULL
);
CREATE INDEX documents_class ON documents(class_id,created DESC,id DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  start INTEGER NOT NULL,
  finish INTEGER NOT NULL CHECK(finish>start),
  created INTEGER NOT NULL
);
CREATE INDEX events_class_start ON events(class_id,start,id);

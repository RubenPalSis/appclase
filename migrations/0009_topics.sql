CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  parent_id TEXT REFERENCES topics(id),
  kind TEXT NOT NULL CHECK(kind IN ('unit','topic','subtopic','lesson','folder')),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX topics_parent ON topics(class_id,parent_id,sort_order,id);
ALTER TABLE materials ADD COLUMN topic_id TEXT REFERENCES topics(id);
ALTER TABLE materials ADD COLUMN body TEXT NOT NULL DEFAULT '';
CREATE INDEX materials_topic ON materials(class_id,topic_id,created DESC,id DESC);

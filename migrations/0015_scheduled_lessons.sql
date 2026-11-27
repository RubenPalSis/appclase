CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  opens INTEGER NOT NULL,
  hidden_until_open INTEGER NOT NULL DEFAULT 0 CHECK (hidden_until_open IN (0,1)),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE INDEX lessons_schedule ON lessons(class_id,opens,id);

-- Keep the existing exam table compatible with the currently deployed writer.
CREATE TABLE hidden_exams (
  exam_id TEXT PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE
);

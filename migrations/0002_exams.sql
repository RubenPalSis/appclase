CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  opens INTEGER NOT NULL,
  closes INTEGER NOT NULL CHECK(closes>opens),
  duration INTEGER NOT NULL CHECK(duration>=60),
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
  questions TEXT NOT NULL
);
CREATE INDEX exams_class ON exams(class_id,opens,id);

CREATE TABLE exam_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  number INTEGER NOT NULL,
  started INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  submitted INTEGER,
  score INTEGER,
  UNIQUE(exam_id,user_id,number)
);
CREATE INDEX exam_attempts_user ON exam_attempts(exam_id,user_id,number DESC);

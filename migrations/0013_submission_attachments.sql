CREATE TABLE submission_attachments (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (assignment_id, user_id),
  FOREIGN KEY (assignment_id, user_id) REFERENCES submissions(assignment_id, user_id) ON DELETE CASCADE
);

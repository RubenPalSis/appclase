CREATE TABLE messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX messages_thread ON messages(class_id,student_id,sequence DESC);
CREATE INDEX messages_sender ON messages(sender_id,created DESC);
CREATE INDEX messages_recipient ON messages(class_id,recipient_id,sequence);
CREATE TABLE message_reads (
  class_id TEXT NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  reader_id TEXT NOT NULL REFERENCES users(id),
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(class_id,student_id,reader_id)
);
CREATE TABLE message_reports (
  message_id INTEGER PRIMARY KEY REFERENCES messages(sequence),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created INTEGER NOT NULL
);

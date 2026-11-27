CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')),
  PRIMARY KEY(org_id,user_id)
);
CREATE INDEX memberships_user ON memberships(user_id,org_id);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE classes (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  teacher_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, subject TEXT NOT NULL,
  description TEXT NOT NULL, academic_year TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE INDEX classes_org ON classes(org_id,teacher_id);
CREATE TABLE class_students (
  class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(class_id,user_id)
);
CREATE INDEX class_students_user ON class_students(user_id,class_id);
CREATE TABLE invitations (
  code TEXT PRIMARY KEY, class_id TEXT NOT NULL UNIQUE REFERENCES classes(id), expires INTEGER NOT NULL
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX posts_class ON posts(class_id,created DESC,id DESC);
CREATE TABLE materials (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), title TEXT NOT NULL,
  url TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX materials_class ON materials(class_id,created DESC);
CREATE TABLE assignments (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), title TEXT NOT NULL,
  body TEXT NOT NULL, due INTEGER NOT NULL, points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 1000),
  allow_late INTEGER NOT NULL CHECK(allow_late IN (0,1))
);
CREATE INDEX assignments_class ON assignments(class_id,due,id);
CREATE TABLE submissions (
  assignment_id TEXT NOT NULL REFERENCES assignments(id), user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, submitted INTEGER NOT NULL, score INTEGER, feedback TEXT,
  PRIMARY KEY(assignment_id,user_id)
);
CREATE TABLE attendance (
  class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
  day TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
  notes TEXT NOT NULL,
  PRIMARY KEY(class_id,day,user_id)
);
CREATE INDEX attendance_student ON attendance(class_id,user_id,day DESC);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  actor TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX audit_org ON audit_logs(org_id,created DESC);

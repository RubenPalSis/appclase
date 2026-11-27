CREATE TABLE password_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id), salt TEXT NOT NULL, digest TEXT NOT NULL);

CREATE TABLE login_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);

CREATE INDEX login_limits_window ON login_limits(window);

CREATE TABLE administrators (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(org_id,user_id) ON DELETE CASCADE
);

INSERT INTO administrators SELECT org_id,user_id,active FROM memberships WHERE role='admin';

CREATE TABLE teachers (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(org_id,user_id) ON DELETE CASCADE
);

INSERT INTO teachers SELECT org_id,user_id,active FROM memberships WHERE role='teacher';

CREATE TABLE students (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(org_id,user_id) ON DELETE CASCADE
);

INSERT INTO students SELECT org_id,user_id,active FROM memberships WHERE role='student';

CREATE TRIGGER sync_roles_insert AFTER INSERT ON memberships BEGIN
  INSERT INTO administrators SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='admin';
  INSERT INTO teachers SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='teacher';
  INSERT INTO students SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='student';
END;

CREATE TRIGGER sync_roles_update AFTER UPDATE ON memberships BEGIN
  DELETE FROM administrators WHERE organization_id=OLD.org_id AND user_id=OLD.user_id;
  INSERT INTO administrators SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='admin';
  DELETE FROM teachers WHERE organization_id=OLD.org_id AND user_id=OLD.user_id;
  INSERT INTO teachers SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='teacher';
  DELETE FROM students WHERE organization_id=OLD.org_id AND user_id=OLD.user_id;
  INSERT INTO students SELECT NEW.org_id,NEW.user_id,NEW.active WHERE NEW.role='student';
END;

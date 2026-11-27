CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL REFERENCES classes(id),
  recipient_id TEXT REFERENCES users(id),
  category TEXT NOT NULL CHECK(category IN ('announcement','material','assignment','exam','grade','message')),
  created INTEGER NOT NULL
);
CREATE INDEX notifications_class ON notifications(class_id,id DESC);
CREATE INDEX notifications_recipient ON notifications(recipient_id,id DESC);
CREATE TABLE notification_reads (
  user_id TEXT NOT NULL REFERENCES users(id),
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  PRIMARY KEY(user_id,notification_id)
);
CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK(category IN ('announcement','material','assignment','exam','grade','message')),
  PRIMARY KEY(user_id,category)
);
CREATE TRIGGER notification_post AFTER INSERT ON posts BEGIN
  INSERT INTO notifications(class_id,category,created) VALUES (NEW.class_id,'announcement',NEW.created);
END;
CREATE TRIGGER notification_material AFTER INSERT ON materials BEGIN
  INSERT INTO notifications(class_id,category,created) VALUES (NEW.class_id,'material',NEW.created);
END;
CREATE TRIGGER notification_document AFTER INSERT ON documents BEGIN
  INSERT INTO notifications(class_id,category,created) VALUES (NEW.class_id,'material',NEW.created);
END;
CREATE TRIGGER notification_assignment AFTER INSERT ON assignments BEGIN
  INSERT INTO notifications(class_id,category,created) VALUES (NEW.class_id,'assignment',unixepoch());
END;
CREATE TRIGGER notification_exam AFTER INSERT ON exams BEGIN
  INSERT INTO notifications(class_id,category,created) VALUES (NEW.class_id,'exam',unixepoch());
END;
CREATE TRIGGER notification_grade AFTER UPDATE OF score,feedback ON submissions
WHEN NEW.score IS NOT NULL AND (NEW.score IS NOT OLD.score OR NEW.feedback IS NOT OLD.feedback) BEGIN
  INSERT INTO notifications(class_id,recipient_id,category,created)
  SELECT class_id,NEW.user_id,'grade',unixepoch() FROM assignments WHERE id=NEW.assignment_id;
END;
CREATE TRIGGER notification_message AFTER INSERT ON messages BEGIN
  INSERT INTO notifications(class_id,recipient_id,category,created) VALUES (NEW.class_id,NEW.recipient_id,'message',NEW.created);
END;

ALTER TABLE classes ADD COLUMN student_posts INTEGER NOT NULL DEFAULT 0 CHECK(student_posts IN (0,1));
ALTER TABLE classes ADD COLUMN student_comments INTEGER NOT NULL DEFAULT 0 CHECK(student_comments IN (0,1));
ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
ALTER TABLE posts ADD COLUMN publish_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN updated INTEGER;
CREATE INDEX posts_published ON posts(class_id,pinned DESC,publish_at,created DESC);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX comments_post ON comments(post_id,created,id);
ALTER TABLE notifications ADD COLUMN post_id TEXT;
CREATE INDEX notification_post_target ON notifications(post_id);
DROP TRIGGER notification_post;
CREATE TRIGGER notification_post AFTER INSERT ON posts BEGIN
  INSERT INTO notifications(class_id,category,created,post_id)
  VALUES (NEW.class_id,'announcement',MAX(NEW.created,NEW.publish_at),NEW.id);
END;
CREATE TRIGGER notification_post_deleted AFTER DELETE ON posts BEGIN
  DELETE FROM notification_reads WHERE notification_id IN (SELECT id FROM notifications WHERE post_id=OLD.id);
  DELETE FROM notifications WHERE post_id=OLD.id;
END;

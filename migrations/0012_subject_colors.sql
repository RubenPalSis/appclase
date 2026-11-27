CREATE TABLE subject_colors (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY (org_id, subject_key)
);

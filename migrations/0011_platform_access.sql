ALTER TABLE organizations ADD COLUMN access_code TEXT;
CREATE UNIQUE INDEX organizations_access_code ON organizations(access_code);
ALTER TABLE password_credentials ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0 CHECK(must_change IN (0,1));
UPDATE organizations SET access_code=upper(substr(hex(randomblob(2)),1,4)) WHERE id='centro-inicial' AND access_code IS NULL;
CREATE TABLE platform_administrators (user_id TEXT PRIMARY KEY REFERENCES users(id));
INSERT INTO platform_administrators SELECT user_id FROM administrators
WHERE organization_id='centro-inicial' AND active=1;
INSERT INTO memberships (org_id,user_id,role,active)
SELECT o.id,p.user_id,'admin',1 FROM organizations o CROSS JOIN platform_administrators p
WHERE 1 ON CONFLICT(org_id,user_id) DO UPDATE SET role='admin',active=1;

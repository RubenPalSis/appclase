import { HttpError, first, list, now, statement, text, token } from './security.ts';

export const organizations = (db, user) => list(db, `
  SELECT o.id,o.name,m.role,CASE WHEN m.role IN ('teacher','admin') THEN o.access_code END AS access_code FROM memberships m JOIN organizations o ON o.id=m.org_id
  WHERE m.user_id=? AND m.active=1 ORDER BY o.name LIMIT 100`, user.id);

export const visibleClasses = (db, user) => list(db, `
  SELECT c.*,sc.color AS subject_color,o.name AS organization,m.role FROM memberships m
  JOIN classes c ON c.org_id=m.org_id JOIN organizations o ON o.id=c.org_id
  LEFT JOIN subject_colors sc ON sc.org_id=c.org_id AND sc.subject_key=LOWER(TRIM(c.subject))
  WHERE m.user_id=? AND m.active=1 AND (m.role='admin' OR (m.role='teacher' AND c.teacher_id=m.user_id)
    OR (m.role='student' AND EXISTS(SELECT 1 FROM class_students s WHERE s.class_id=c.id AND s.user_id=m.user_id)))
  ORDER BY c.archived,c.name,c.id LIMIT 100`, user.id);

export async function classAccess(db, id, user) {
  const course = await first(db, `
    SELECT c.*,sc.color AS subject_color,m.role FROM classes c JOIN memberships m ON m.org_id=c.org_id AND m.user_id=? AND m.active=1
    LEFT JOIN subject_colors sc ON sc.org_id=c.org_id AND sc.subject_key=LOWER(TRIM(c.subject))
    WHERE c.id=? AND (m.role='admin' OR (m.role='teacher' AND c.teacher_id=m.user_id)
      OR (m.role='student' AND EXISTS(SELECT 1 FROM class_students s WHERE s.class_id=c.id AND s.user_id=m.user_id)))`,
  user.id, id);
  if (!course) throw new HttpError(404, 'La clase no está disponible.');
  return course;
}

export function requireStaff(course, writable = true) {
  if (course.role === 'student') throw new HttpError(403, 'Esta acción requiere permisos de profesor.');
  if (writable && course.archived) throw new HttpError(409, 'La clase está archivada.');
}

export const audit = (db, org, actor, action, target) =>
  statement(db, 'INSERT INTO audit_logs VALUES (?,?,?,?,?,?)', crypto.randomUUID(), org, actor, action, target, now());

export async function createClass(db, user, data) {
  const org = text(data.org_id, 80);
  const membership = await first(db, 'SELECT role FROM memberships WHERE org_id=? AND user_id=? AND active=1', org, user.id);
  if (!['admin','teacher'].includes(membership?.role)) throw new HttpError(403, 'No puedes crear clases en este centro.');
  const id = crypto.randomUUID();
  const subject = text(data.subject, 120);
  const color = data.subject_color === undefined ? null : subjectColor(data.subject_color);
  await db.batch([
    ...(color ? [statement(db, `INSERT INTO subject_colors VALUES (?,LOWER(TRIM(?)),?)
      ON CONFLICT(org_id,subject_key) DO NOTHING`, org, subject, color)] : []),
    statement(db, 'INSERT INTO classes (id,org_id,teacher_id,name,subject,description,academic_year) VALUES (?,?,?,?,?,?,?)',
      id, org, user.id, text(data.name, 120), subject, text(data.description ?? '', 2000, 0), text(data.academic_year, 30)),
    audit(db, org, user.id, 'class.created', id),
  ]);
  return { id };
}

function subjectColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new HttpError(400, 'Elige un color válido para la asignatura.');
  }
  return value.toLowerCase();
}

export async function updateSubjectColor(db, course, user, data) {
  requireStaff(course);
  const color = subjectColor(data.subject_color);
  await db.batch([
    statement(db, `INSERT INTO subject_colors VALUES (?,LOWER(TRIM(?)),?)
      ON CONFLICT(org_id,subject_key) DO UPDATE SET color=excluded.color`, course.org_id, course.subject, color),
    audit(db, course.org_id, user.id, 'class.subject_color.updated', course.id),
  ]);
  return { subject_color: color };
}

export async function invite(db, course, user) {
  requireStaff(course);
  const code = token().slice(0, 24);
  const expires = now() + 7 * 86400;
  await db.batch([
    statement(db, 'INSERT INTO invitations VALUES (?,?,?) ON CONFLICT(class_id) DO UPDATE SET code=excluded.code,expires=excluded.expires',
      code, course.id, expires),
    audit(db, course.org_id, user.id, 'invitation.rotated', course.id),
  ]);
  return { code, expires };
}

export async function joinClass(db, user, data) {
  const code = text(data.code, 24, 24).toLowerCase();
  const invitation = await first(db, `
    SELECT c.id,c.org_id,m.role FROM invitations i JOIN classes c ON c.id=i.class_id
    LEFT JOIN memberships m ON m.org_id=c.org_id AND m.user_id=?
    WHERE i.code=? AND i.expires>? AND c.archived=0`, user.id, code, now());
  if (!invitation) throw new HttpError(404, 'El código ha caducado o no es válido.');
  if (invitation.role && invitation.role !== 'student') throw new HttpError(409, 'Ya tienes un rol de personal en este centro.');
  const timestamp = now();
  const guard = `EXISTS (SELECT 1 FROM invitations i JOIN classes c ON c.id=i.class_id
    WHERE i.code=? AND i.class_id=? AND i.expires>? AND c.archived=0)`;
  const [, enrolled] = await db.batch([
    statement(db, `INSERT OR IGNORE INTO memberships (org_id,user_id,role) SELECT ?,?,'student' WHERE ${guard}`,
      invitation.org_id, user.id, code, invitation.id, timestamp),
    statement(db, `INSERT INTO class_students SELECT ?,? WHERE ${guard}
      AND EXISTS (SELECT 1 FROM memberships WHERE org_id=? AND user_id=? AND role='student' AND active=1)
      ON CONFLICT(class_id,user_id) DO UPDATE SET user_id=excluded.user_id`,
      invitation.id, user.id, code, invitation.id, timestamp, invitation.org_id, user.id),
  ]);
  if (!enrolled.meta.changes) throw new HttpError(409, 'La invitación ya no está disponible.');
  return { id: invitation.id };
}

export async function archive(db, course, user, data) {
  requireStaff(course, false);
  if (typeof data.archived !== 'boolean') throw new HttpError(400, 'Estado de clase no válido.');
  await db.batch([
    statement(db, 'UPDATE classes SET archived=? WHERE id=?', Number(data.archived), course.id),
    audit(db, course.org_id, user.id, data.archived ? 'class.archived' : 'class.restored', course.id),
  ]);
  return {};
}

export async function importStudents(db, course, user, data) {
  requireStaff(course);
  if (!Array.isArray(data.emails) || !data.emails.length || data.emails.length > 50) {
    throw new HttpError(400, 'El CSV debe incluir entre 1 y 50 correos.');
  }
  const emails = [...new Set<string>(data.emails.map(value => text(value, 254).toLowerCase()))];
  if (emails.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
    throw new HttpError(400, 'Revisa los correos del CSV.');
  }
  const results = await db.batch([...emails.map(email => statement(db, `
    INSERT INTO class_students (class_id,user_id)
    SELECT c.id,u.id FROM users u
    JOIN memberships m ON m.user_id=u.id AND m.role='student' AND m.active=1
    JOIN classes c ON c.org_id=m.org_id AND c.id=? AND c.archived=0
    WHERE u.email=?
    ON CONFLICT(class_id,user_id) DO UPDATE SET user_id=excluded.user_id`, course.id, email)),
  audit(db, course.org_id, user.id, 'class.students.imported', course.id)]);
  return {
    processed: emails.length,
    unavailable: emails.filter((_, index) => !results[index].meta.changes),
  };
}

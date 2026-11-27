import { HttpError, integer, list, run } from './security.js';

const categories = ['announcement','material','assignment','exam','grade','message'];
const visible = `FROM notifications n JOIN classes c ON c.id=n.class_id
  JOIN memberships m ON m.org_id=c.org_id AND m.user_id=?1 AND m.active=1
  WHERE n.created<=unixepoch() AND (
     (m.role='admin') OR (m.role='teacher' AND c.teacher_id=?1)
     OR (m.role='student' AND EXISTS(SELECT 1 FROM class_students s WHERE s.class_id=c.id AND s.user_id=?1))
  ) AND (n.recipient_id=?1 OR (n.recipient_id IS NULL AND m.role='student'))
  AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.user_id=?1 AND p.category=n.category)`;

export function notifications(db, user) {
  return list(db, `SELECT n.id,n.class_id,c.name,n.category,n.created,
    EXISTS(SELECT 1 FROM notification_reads r WHERE r.user_id=?1 AND r.notification_id=n.id) AS seen
    ${visible} ORDER BY n.id DESC LIMIT 50`, user.id);
}

export async function readNotification(db, user, id) {
  const result = await run(db, `INSERT INTO notification_reads SELECT ?1,n.id ${visible}
    AND n.id=?2 ON CONFLICT(user_id,notification_id) DO UPDATE SET notification_id=excluded.notification_id`,
  user.id, integer(id, 1, Number.MAX_SAFE_INTEGER));
  if (!result.meta.changes) throw new HttpError(404, 'El aviso no está disponible.');
  return {};
}

export async function preferences(db, user) {
  const muted = await list(db, 'SELECT category FROM notification_preferences WHERE user_id=?', user.id);
  const values = new Set(muted.map(row => row.category));
  return categories.map(category => ({ category, enabled: !values.has(category) }));
}

export async function setPreference(db, user, data) {
  if (!categories.includes(data.category) || typeof data.enabled !== 'boolean') {
    throw new HttpError(400, 'La preferencia no es válida.');
  }
  if (data.enabled) {
    await run(db, 'DELETE FROM notification_preferences WHERE user_id=? AND category=?', user.id, data.category);
  } else {
    await run(db, 'INSERT OR IGNORE INTO notification_preferences VALUES (?,?)', user.id, data.category);
  }
  return {};
}

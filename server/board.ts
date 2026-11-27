import { audit, requireStaff } from './classes.ts';
import { HttpError, first, integer, list, now, run, statement, text } from './security.ts';

export function board(db, course, user) {
  return list(db, `SELECT p.*,u.name AS author FROM posts p JOIN users u ON u.id=p.author_id
    WHERE p.class_id=? AND (p.publish_at<=? OR ?=1 OR p.author_id=?)
    ORDER BY p.pinned DESC,MAX(p.created,p.publish_at) DESC,p.id DESC LIMIT 100`,
  course.id, now(), Number(course.role !== 'student'), user.id);
}

export async function publish(db, course, user, data) {
  if (course.archived) throw new HttpError(409, 'La clase está archivada.');
  if (course.role === 'student' && !course.student_posts) throw new HttpError(403, 'El tablón solo admite publicaciones del profesorado.');
  const timestamp = now();
  const scheduled = data.publish_at !== undefined;
  const pinned = data.pinned === true;
  if (course.role === 'student' && (scheduled || pinned)) throw new HttpError(403, 'Solo el profesorado puede programar o fijar publicaciones.');
  const publishAt = scheduled ? integer(data.publish_at, timestamp + 1, timestamp + 90 * 86400) : timestamp;
  const id = crypto.randomUUID();
  const body = text(data.body, 4000);
  const result = await run(db, `INSERT INTO posts(id,class_id,author_id,body,created,pinned,publish_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM
    (SELECT 1 FROM posts WHERE class_id=? AND author_id=? AND created>=? LIMIT 5))<5`,
  id, course.id, user.id, body, timestamp, Number(pinned), publishAt, course.id, user.id, timestamp - 60);
  if (!result.meta.changes) throw new HttpError(429, 'Espera un minuto antes de volver a publicar.');
  return {};
}

async function post(db, course, user, id) {
  const value = await first(db, 'SELECT * FROM posts WHERE class_id=? AND id=?', course.id, id);
  if (!value || (course.role === 'student' && value.publish_at > now() && value.author_id !== user.id)) {
    throw new HttpError(404, 'No se encuentra la publicación.');
  }
  return value;
}

export async function change(db, course, user, id, action, data) {
  if (course.archived) throw new HttpError(409, 'La clase está archivada.');
  const value = await post(db, course, user, id);
  if (course.role === 'student' && (value.author_id !== user.id || !course.student_posts || action === 'pin')) {
    throw new HttpError(403, 'No puedes modificar esta publicación.');
  }
  const statements = {
    edit: () => statement(db, 'UPDATE posts SET body=?,updated=? WHERE id=?',
      text(data.body, 4000), now(), id),
    pin: () => statement(db, 'UPDATE posts SET pinned=? WHERE id=?', Number(!value.pinned), id),
    delete: () => statement(db, 'DELETE FROM posts WHERE id=?', id),
  };
  if (!Object.hasOwn(statements, action)) throw new HttpError(404, 'Operación no disponible.');
  await db.batch([
    statements[action](),
    audit(db, course.org_id, user.id, 'board.' + action, id),
  ]);
  return {};
}

export async function remarks(db, course, user, id) {
  await post(db, course, user, id);
  return list(db, `SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.author_id
    WHERE c.post_id=? ORDER BY c.created,c.id LIMIT 100`, id);
}

export async function comment(db, course, user, id, data) {
  if (course.archived) throw new HttpError(409, 'La clase está archivada.');
  if (course.role === 'student' && !course.student_comments) throw new HttpError(403, 'Los comentarios del alumnado están desactivados.');
  const value = await post(db, course, user, id);
  if (value.publish_at > now()) throw new HttpError(409, 'Esta publicación aún no está visible.');
  const result = await run(db, `INSERT INTO comments
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM comments
      WHERE post_id=? AND author_id=? AND created>=? LIMIT 8))<8`,
  crypto.randomUUID(), id, user.id, text(data.body, 2000), now(), id, user.id, now() - 60);
  if (!result.meta.changes) throw new HttpError(429, 'Espera un minuto antes de comentar de nuevo.');
  return {};
}

export async function permissions(db, course, user, data) {
  requireStaff(course);
  if (typeof data.student_posts !== 'boolean' || typeof data.student_comments !== 'boolean') {
    throw new HttpError(400, 'Revisa los permisos del tablón.');
  }
  await db.batch([
    statement(db, 'UPDATE classes SET student_posts=?,student_comments=? WHERE id=?',
      Number(data.student_posts), Number(data.student_comments), course.id),
    audit(db, course.org_id, user.id, 'board.permissions', course.id),
  ]);
  return {};
}

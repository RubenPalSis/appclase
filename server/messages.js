import { HttpError, first, integer, list, now, run, text } from './security.js';

async function participant(db, course, user, studentId) {
  if (course.role === 'student' && user.id !== studentId || course.role !== 'student' && user.id !== course.teacher_id) {
    throw new HttpError(404, 'No se encuentra la conversación.');
  }
  const student = await first(db, `SELECT u.id,u.name FROM class_students s JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=u.id AND m.org_id=? WHERE s.class_id=? AND s.user_id=?
    AND m.role='student' AND m.active=1`, course.org_id, course.id, studentId);
  const teacher = await first(db, `SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id
    WHERE u.id=? AND m.org_id=? AND m.role IN ('teacher','admin') AND m.active=1`, course.teacher_id, course.org_id);
  if (!student || !teacher) throw new HttpError(404, 'No se encuentra la conversación.');
  return course.role === 'student' ? teacher : student;
}

export async function threads(db, course, user) {
  if (course.role === 'student') {
    const teacher = await participant(db, course, user, user.id);
    const row = await first(db, `SELECT COUNT(*) AS unread FROM messages
      WHERE class_id=?1 AND student_id=?2 AND recipient_id=?2 AND sequence>COALESCE(
        (SELECT last_seen FROM message_reads WHERE class_id=?1 AND student_id=?2 AND reader_id=?2),0)`, course.id, user.id);
    return [{ student_id: user.id, name: teacher.name, unread: row.unread }];
  }
  if (user.id !== course.teacher_id) return [];
  return list(db, `SELECT u.id AS student_id,u.name,
    (SELECT COUNT(*) FROM messages t WHERE t.class_id=?1 AND t.student_id=u.id AND t.recipient_id=?2
      AND t.sequence>COALESCE((SELECT last_seen FROM message_reads r
        WHERE r.class_id=?1 AND r.student_id=u.id AND r.reader_id=?2),0)) AS unread
    FROM class_students s JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=u.id AND m.org_id=?3 AND m.role='student' AND m.active=1
    WHERE s.class_id=?1 ORDER BY unread DESC,u.name,u.id LIMIT 100`, course.id, user.id, course.org_id);
}

export async function thread(db, course, user, student) {
  await participant(db, course, user, student);
  const rows = await list(db, `SELECT sequence,body,created,sender_id=(?1) AS mine FROM messages
    WHERE class_id=?2 AND student_id=?3 ORDER BY sequence DESC LIMIT 100`, user.id, course.id, student);
  return rows.reverse();
}

export async function send(db, course, user, student, data) {
  if (course.archived) throw new HttpError(409, 'La clase está archivada.');
  const recipient = await participant(db, course, user, student);
  const timestamp = now();
  const result = await run(db, `INSERT INTO messages (class_id,student_id,sender_id,recipient_id,body,created)
    SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM messages WHERE sender_id=? AND created>=? LIMIT 12)) < 12`,
  course.id, student, user.id, recipient.id, text(data.body, 2000), timestamp, user.id, timestamp - 60);
  if (!result.meta.changes) throw new HttpError(429, 'Has enviado muchos mensajes. Espera un minuto.');
  return {};
}

export async function markRead(db, course, user, student, data) {
  await participant(db, course, user, student);
  const sequence = integer(data.last_seen, 0, Number.MAX_SAFE_INTEGER);
  await run(db, `INSERT INTO message_reads
    SELECT ?1,?2,?3,COALESCE(MAX(sequence),0) FROM messages
    WHERE class_id=?1 AND student_id=?2 AND sequence<=?4
    ON CONFLICT(class_id,student_id,reader_id) DO UPDATE SET last_seen=MAX(message_reads.last_seen,excluded.last_seen)`,
  course.id, student, user.id, sequence);
  return {};
}

export async function report(db, course, user, student, data) {
  await participant(db, course, user, student);
  const sequence = integer(data.id, 1, Number.MAX_SAFE_INTEGER);
  const result = await run(db, `INSERT INTO message_reports SELECT sequence,?,?,? FROM messages
    WHERE sequence=? AND class_id=? AND student_id=? AND recipient_id=?
    ON CONFLICT(message_id) DO UPDATE SET reason=excluded.reason`,
  user.id, text(data.reason, 1000), now(), sequence, course.id, student, user.id);
  if (!result.meta.changes) throw new HttpError(404, 'No se puede informar de este mensaje.');
  return {};
}

export function reports(db, org) {
  return list(db, `SELECT r.message_id,r.reason,r.created,m.body,c.name AS course,u.name AS reporter,s.name AS sender
    FROM message_reports r JOIN messages m ON m.sequence=r.message_id
    JOIN classes c ON c.id=m.class_id JOIN users u ON u.id=r.reporter_id JOIN users s ON s.id=m.sender_id
    WHERE c.org_id=? ORDER BY r.created DESC LIMIT 100`, org);
}

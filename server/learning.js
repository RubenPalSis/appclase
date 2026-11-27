import { requireStaff } from './classes.js';
import { HttpError, first, integer, list, now, run, text } from './security.js';

export const assignments = (db, course, user) => list(db, `
  SELECT a.*,s.submitted,s.body AS answer,s.score,s.feedback
  FROM assignments a LEFT JOIN submissions s ON s.assignment_id=a.id AND s.user_id=?
  WHERE a.class_id=? ORDER BY a.due,a.id LIMIT 100`, user.id, course.id);

export async function addAssignment(db, course, data) {
  requireStaff(course);
  if (typeof data.allow_late !== 'boolean') throw new HttpError(400, 'Indica si admites entregas tardías.');
  await run(db, 'INSERT INTO assignments VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), course.id,
    text(data.title, 160), text(data.body, 6000), integer(data.due, now() + 1, 4102444800),
    integer(data.points, 1, 1000), Number(data.allow_late));
  return {};
}

export async function deliver(db, course, user, assignment, data) {
  if (course.archived || course.role !== 'student') throw new HttpError(403, 'No puedes entregar esta tarea.');
  const timestamp = now();
  const result = await run(db, `
    INSERT INTO submissions (assignment_id,user_id,body,submitted)
    SELECT a.id,?,?,? FROM assignments a JOIN classes c ON c.id=a.class_id
    WHERE a.id=? AND a.class_id=? AND c.archived=0 AND (a.allow_late=1 OR a.due>=?)
    ON CONFLICT(assignment_id,user_id) DO UPDATE SET body=excluded.body,submitted=excluded.submitted
    WHERE submissions.score IS NULL`,
  user.id, text(data.body, 10000), timestamp, assignment, course.id, timestamp);
  if (!result.meta.changes) throw new HttpError(409, 'La tarea no admite entregas o ya se ha calificado.');
  return {};
}

export function reviews(db, course, assignment) {
  requireStaff(course, false);
  return list(db, `SELECT s.user_id,u.name,s.body,s.submitted,s.score,s.feedback FROM submissions s
    JOIN users u ON u.id=s.user_id JOIN assignments a ON a.id=s.assignment_id
    WHERE a.class_id=? AND a.id=? ORDER BY u.name,u.id LIMIT 100`, course.id, assignment);
}

export async function grade(db, course, assignment, data) {
  requireStaff(course);
  const task = await first(db, 'SELECT points FROM assignments WHERE id=? AND class_id=?', assignment, course.id);
  if (!task) throw new HttpError(404, 'No se encuentra la tarea.');
  const result = await run(db, 'UPDATE submissions SET score=?,feedback=? WHERE assignment_id=? AND user_id=?',
    integer(data.score, 0, task.points), text(data.feedback, 4000, 0), assignment, text(data.user_id, 100));
  if (!result.meta.changes) throw new HttpError(404, 'No se encuentra la entrega.');
  return {};
}

export function students(db, course) {
  requireStaff(course, false);
  return list(db, `SELECT u.id,u.name FROM class_students s JOIN users u ON u.id=s.user_id
    WHERE s.class_id=? ORDER BY u.name,u.id LIMIT 100`, course.id);
}

export function attendanceDay(value) {
  const day = text(value, 10, 10);
  const instant = new Date(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+instant) || instant.toISOString().slice(0,10) !== day) {
    throw new HttpError(400, 'La fecha de asistencia no es válida.');
  }
  return day;
}

export function attendance(db, course, user, day) {
  if (course.role === 'student') {
    return list(db, 'SELECT day,status,notes FROM attendance WHERE class_id=? AND user_id=? ORDER BY day DESC LIMIT 100',
      course.id, user.id);
  }
  return list(db, `SELECT u.id,u.name,a.status,a.notes FROM class_students s
    JOIN users u ON u.id=s.user_id LEFT JOIN attendance a ON a.user_id=s.user_id AND a.class_id=s.class_id AND a.day=?
    WHERE s.class_id=? ORDER BY u.name,u.id LIMIT 100`, attendanceDay(day), course.id);
}

export async function markAttendance(db, course, data) {
  requireStaff(course);
  if (!['present','absent','late','excused'].includes(data.status)) throw new HttpError(400, 'Estado de asistencia no válido.');
  const result = await run(db, `INSERT INTO attendance
    SELECT class_id,user_id,?,?,? FROM class_students WHERE class_id=? AND user_id=?
    ON CONFLICT(class_id,day,user_id) DO UPDATE SET status=excluded.status,notes=excluded.notes`,
  attendanceDay(data.day), data.status, text(data.notes, 1000, 0), course.id, text(data.user_id, 100));
  if (!result.meta.changes) throw new HttpError(404, 'No se encuentra al alumno.');
  return {};
}

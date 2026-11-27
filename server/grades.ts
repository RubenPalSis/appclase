import { requireStaff } from './classes.ts';
import { list } from './security.ts';

export function gradeRows(db, course, user) {
  if (course.role === 'student') {
    return list(db, `SELECT a.title,s.score,a.points,s.feedback FROM submissions s
      JOIN assignments a ON a.id=s.assignment_id WHERE a.class_id=? AND s.user_id=? AND s.score IS NOT NULL
      ORDER BY a.due,a.id LIMIT 100`, course.id, user.id);
  }
  return list(db, `SELECT u.name,COUNT(*) AS graded,SUM(s.score) AS score,SUM(a.points) AS points
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN users u ON u.id=s.user_id
    WHERE a.class_id=? AND s.score IS NOT NULL GROUP BY s.user_id,u.name ORDER BY u.name,u.id LIMIT 100`, course.id);
}

function cell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function exportGrades(db, course) {
  requireStaff(course, false);
  const rows = await list(db, `SELECT u.name,a.title,s.score,a.points FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id JOIN users u ON u.id=s.user_id
    WHERE a.class_id=? AND s.score IS NOT NULL ORDER BY u.name,a.due,a.id LIMIT 2000`, course.id);
  const lines = [['Alumno','Tarea','Nota','Máximo'], ...rows.map(row => [row.name,row.title,row.score,row.points])];
  return new Response('\uFEFF' + lines.map(line => line.map(cell).join(';')).join('\r\n') + '\r\n', { headers: {
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':'attachment; filename="appclase-calificaciones.csv"',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
  }});
}

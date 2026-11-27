import { requireStaff } from './classes.ts';
import { bucket, downloadObject, readDocument } from './documents.ts';
import { HttpError, first, integer, list, now, run, text } from './security.ts';

export function lessons(db, course) {
  const timestamp = now();
  return list(db, `SELECT id,title,opens,hidden_until_open,opens>?2 AS locked,
    CASE WHEN ?3=1 OR opens<=?2 THEN description END AS description,
    CASE WHEN ?3=1 OR opens<=?2 THEN mime END AS mime,
    CASE WHEN ?3=1 OR opens<=?2 THEN filename END AS filename
    FROM lessons WHERE class_id=?1 AND (?3=1 OR hidden_until_open=0 OR opens<=?2)
    ORDER BY opens,id LIMIT 150`, course.id, timestamp, Number(course.role !== 'student'));
}

export async function createLesson(env, course, request, params) {
  requireStaff(course);
  const storage = bucket(env);
  const title = text(params.get('title'), 160);
  const description = text(params.get('description') ?? '', 1000, 0);
  const opens = integer(Number(params.get('opens')), 0, 4102444800);
  const hidden = Number(params.get('hidden') === '1');
  const file = await readDocument(request, params.get('name'), true);
  const id = crypto.randomUUID();
  const key = course.id + '/lessons/' + id;
  await storage.put(key, file.bytes);
  try {
    await run(env.DB, 'INSERT INTO lessons VALUES (?,?,?,?,?,?,?,?,?)',
      id, course.id, title, description, opens, hidden, file.name, file.mime, file.total);
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  return { id };
}

export async function scheduleLesson(db, course, id, data) {
  requireStaff(course);
  if (typeof data.hidden_until_open !== 'boolean') throw new HttpError(400, 'Selecciona la visibilidad.');
  const result = await run(db, 'UPDATE lessons SET opens=?,hidden_until_open=? WHERE id=? AND class_id=?',
    integer(data.opens, 0, 4102444800), Number(data.hidden_until_open), id, course.id);
  if (!result.meta.changes) throw new HttpError(404, 'No se encuentra la videoclase o el PDF.');
  return {};
}

export async function lessonFile(env, course, id, request) {
  const file = await first(env.DB, 'SELECT * FROM lessons WHERE id=? AND class_id=?', id, course.id);
  const timestamp = now();
  if (!file || course.role === 'student' && file.hidden_until_open && file.opens > timestamp) {
    throw new HttpError(404, 'No se encuentra la videoclase o el PDF.');
  }
  if (course.role === 'student' && file.opens > timestamp) throw new HttpError(423, 'Este contenido todavía está bloqueado.');
  const key = course.id + '/lessons/' + file.id;
  if (!file.mime.startsWith('video/')) return downloadObject(env, key, file.filename);
  const storage = bucket(env);
  const range = request.headers.get('range');
  const headers = new Headers({
    'Cache-Control': 'private, no-store', 'Content-Type': file.mime,
    'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
  });
  let start = 0;
  let end = file.bytes - 1;
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (parts && parts[1]) {
      start = Number(parts[1]);
      if (parts[2]) end = Math.min(end, Number(parts[2]));
    } else if (parts && parts[2]) {
      const suffix = Number(parts[2]);
      start = suffix ? Math.max(0, file.bytes - suffix) : file.bytes;
    } else {
      start = file.bytes;
    }
    if (!Number.isSafeInteger(start) || start < 0 || start > end) {
      headers.set('Content-Range', 'bytes */' + file.bytes);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${file.bytes}`);
  }
  const length = end - start + 1;
  const object = range ? await storage.get(key, { range: { offset: start, length } }) : await storage.get(key);
  if (!object) throw new HttpError(404, 'El archivo no está disponible.');
  headers.set('Content-Length', String(length));
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

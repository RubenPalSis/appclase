import { requireStaff } from './classes.js';
import { HttpError, first, integer, list, now, run, text } from './security.js';

const kinds = ['unit','topic','subtopic','lesson','folder'];

async function parentTopic(db, course, id) {
  if (id === null || id === undefined) return null;
  const parent = text(id, 64);
  if (!await first(db, 'SELECT id FROM topics WHERE class_id=? AND id=?', course.id, parent)) {
    throw new HttpError(404, 'No se encuentra la sección del temario.');
  }
  return parent;
}

async function topicLevel(db, course, parent) {
  if (!parent) return 0;
  const row = await first(db, `WITH RECURSIVE ancestors(id,parent_id,depth) AS (
    SELECT id,parent_id,1 FROM topics WHERE class_id=?1 AND id=?2
    UNION ALL SELECT t.id,t.parent_id,a.depth+1 FROM ancestors a JOIN topics t ON t.id=a.parent_id
      WHERE t.class_id=?1 AND a.depth<10
  ) SELECT MAX(depth) AS depth FROM ancestors`, course.id, parent);
  return row.depth;
}

export async function sections(db, course, url) {
  const parent = await parentTopic(db, course, url.searchParams.get('topic'));
  return list(db, 'SELECT id,title,kind,sort_order FROM topics WHERE class_id=? AND parent_id IS ? ORDER BY sort_order,id LIMIT 100',
    course.id, parent);
}

export async function createTopic(db, course, data) {
  requireStaff(course);
  if (!kinds.includes(data.kind)) throw new HttpError(400, 'Elige un tipo de sección válido.');
  const parent = await parentTopic(db, course, data.topic_id);
  if (await topicLevel(db, course, parent) >= 8) throw new HttpError(409, 'Has alcanzado el nivel máximo de secciones.');
  const order = integer(data.sort_order, 0, 10000);
  await run(db, 'INSERT INTO topics VALUES (?,?,?,?,?,?)', crypto.randomUUID(), course.id, parent, data.kind, text(data.title, 160), order);
  return {};
}

export async function moveTopic(db, course, id, data) {
  requireStaff(course);
  const result = await run(db, 'UPDATE topics SET sort_order=? WHERE class_id=? AND id=?',
    integer(data.sort_order, 0, 10000), course.id, id);
  if (!result.meta.changes) throw new HttpError(404, 'No se encuentra la sección.');
  return {};
}

export async function resources(db, course, url) {
  const query = url.searchParams.get('q')?.trim();
  if (query) {
    const needle = '%' + text(query, 60).replace(/[\\%_]/g, '\\$&') + '%';
    return list(db, `SELECT r.*,t.title AS topic FROM materials r LEFT JOIN topics t ON t.id=r.topic_id
      WHERE r.class_id=? AND (r.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\')
      ORDER BY r.created DESC,r.id DESC LIMIT 100`, course.id, needle, needle);
  }
  const parent = await parentTopic(db, course, url.searchParams.get('topic'));
  return list(db, 'SELECT * FROM materials WHERE class_id=? AND topic_id IS ? ORDER BY created DESC,id DESC LIMIT 100', course.id, parent);
}

export async function addResource(db, course, data) {
  requireStaff(course);
  const parent = await parentTopic(db, course, data.topic_id);
  const body = text(data.body ?? '', 8000, 0);
  let url = '';
  if (data.url) {
    let value;
    try { value = new URL(text(data.url, 2000)); } catch { throw new HttpError(400, 'Introduce un enlace HTTPS válido.'); }
    if (value.protocol !== 'https:' || value.username || value.password) throw new HttpError(400, 'Introduce un enlace HTTPS válido.');
    url = value.href;
  }
  if (!url && !body) throw new HttpError(400, 'Añade un enlace HTTPS o escribe el contenido.');
  await run(db, 'INSERT INTO materials (id,class_id,title,url,created,topic_id,body) VALUES (?,?,?,?,?,?,?)',
    crypto.randomUUID(), course.id, text(data.title, 160), url, now(), parent, body);
  return {};
}

import { requireStaff } from './classes.ts';
import { HttpError, first, list, now, run, text } from './security.ts';

const maxBytes = 16 * 1024 * 1024;
const types = {
  pdf: { mime: 'application/pdf', signature: [0x25,0x50,0x44,0x46,0x2d] },
  png: { mime: 'image/png', signature: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] },
  jpg: { mime: 'image/jpeg', signature: [0xff,0xd8,0xff] },
  jpeg: { mime: 'image/jpeg', signature: [0xff,0xd8,0xff] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: [0x50,0x4b,3,4] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: [0x50,0x4b,3,4] },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: [0x50,0x4b,3,4] },
};

function bucket(env) {
  if (!env.DOCUMENTS) throw new HttpError(503, 'La subida de documentos aún no está habilitada.');
  return env.DOCUMENTS;
}

export const documents = (db, course) => list(db, `
  SELECT id,name,mime,bytes,created FROM documents WHERE class_id=? ORDER BY created DESC,id DESC LIMIT 100`, course.id);

async function readDocument(request, originalName) {
  const name = text(originalName, 160);
  if (/[\u0000-\u001f\u007f/\\]/u.test(name)) throw new HttpError(400, 'El nombre del documento no es válido.');
  const type = Object.hasOwn(types, name.toLowerCase().split('.').at(-1)) && types[name.toLowerCase().split('.').at(-1)];
  if (!type || request.headers.get('content-type') !== 'application/octet-stream') {
    throw new HttpError(415, 'Selecciona un PDF, una imagen JPG o PNG o un documento de Office compatible.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'No se ha recibido el documento.');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'El documento supera los 16 MB.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!type.signature.every((byte, index) => bytes[index] === byte)) {
    throw new HttpError(415, 'El contenido del documento no coincide con su formato.');
  }
  return { name, bytes, total, mime: type.mime };
}

export async function upload(env, course, request, originalName) {
  requireStaff(course);
  const storage = bucket(env);
  const { name, bytes, total, mime } = await readDocument(request, originalName);
  const id = crypto.randomUUID();
  const key = course.id + '/' + id;
  await storage.put(key, bytes);
  try {
    await run(env.DB, 'INSERT INTO documents VALUES (?,?,?,?,?,?)', id, course.id, name, mime, total, now());
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  return { id };
}

export async function download(env, course, id) {
  const file = await first(env.DB, 'SELECT * FROM documents WHERE id=? AND class_id=?', id, course.id);
  if (!file) throw new HttpError(404, 'El documento no está disponible.');
  return downloadObject(env, course.id + '/' + file.id, file.name);
}

async function downloadObject(env, key, name) {
  const object = await bucket(env).get(key);
  if (!object) throw new HttpError(404, 'El documento no está disponible.');
  return new Response(object.body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16)),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function attachSubmission(env, course, user, assignment, request, originalName) {
  if (course.role !== 'student' || course.archived) throw new HttpError(403, 'No puedes adjuntar archivos a esta tarea.');
  const storage = bucket(env);
  const eligible = await first(env.DB, `SELECT 1 FROM submissions s JOIN assignments a ON a.id=s.assignment_id
    WHERE a.id=? AND a.class_id=? AND s.user_id=? AND s.score IS NULL AND (a.allow_late=1 OR a.due>=?)`,
    assignment, course.id, user.id, now());
  if (!eligible) throw new HttpError(409, 'Envía primero tu respuesta y comprueba el plazo de entrega.');
  const { name, bytes } = await readDocument(request, originalName);
  const id = crypto.randomUUID();
  const key = course.id + '/submissions/' + id;
  await storage.put(key, bytes);
  try {
    const result = await run(env.DB, `INSERT INTO submission_attachments (id,assignment_id,user_id,name)
      SELECT ?,a.id,s.user_id,? FROM submissions s JOIN assignments a ON a.id=s.assignment_id
      JOIN classes c ON c.id=a.class_id
      WHERE a.id=? AND a.class_id=? AND s.user_id=? AND s.score IS NULL AND c.archived=0 AND (a.allow_late=1 OR a.due>=?)
      ON CONFLICT(assignment_id,user_id) DO NOTHING`, id, name, assignment, course.id, user.id, now());
    if (!result.meta.changes) throw new HttpError(409, 'Ya hay un adjunto o la entrega se ha cerrado.');
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  return { id, name };
}

export async function downloadSubmission(env, course, user, assignment, id) {
  const file = await first(env.DB, `SELECT f.id,f.name FROM submission_attachments f
    JOIN assignments a ON a.id=f.assignment_id
    WHERE f.id=? AND a.id=? AND a.class_id=? AND (?<>'student' OR f.user_id=?)`,
    id, assignment, course.id, course.role, user.id);
  if (!file) throw new HttpError(404, 'El documento no está disponible.');
  return downloadObject(env, course.id + '/submissions/' + file.id, file.name);
}

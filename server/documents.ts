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

export async function upload(env, course, request, originalName) {
  requireStaff(course);
  const storage = bucket(env);
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
  const id = crypto.randomUUID();
  const key = course.id + '/' + id;
  await storage.put(key, bytes);
  try {
    await run(env.DB, 'INSERT INTO documents VALUES (?,?,?,?,?,?)', id, course.id, name, type.mime, total, now());
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
  return { id };
}

export async function download(env, course, id) {
  const file = await first(env.DB, 'SELECT * FROM documents WHERE id=? AND class_id=?', id, course.id);
  if (!file) throw new HttpError(404, 'El documento no está disponible.');
  const object = await bucket(env).get(course.id + '/' + file.id);
  if (!object) throw new HttpError(404, 'El documento no está disponible.');
  return new Response(object.body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16)),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

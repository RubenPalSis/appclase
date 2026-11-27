export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const now = () => Math.floor(Date.now() / 1000);
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export const hash = async value => {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(result))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export function text(value, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new HttpError(400, 'Revisa los campos de texto.');
  }
  return value.trim();
}

export function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, 'Revisa los valores numéricos.');
  }
  return value;
}

export async function jsonBody(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'Se esperaba una solicitud JSON.');
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      throw new HttpError(413, 'El contenido supera el tamaño permitido.');
    }
    body += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(body + decoder.decode());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    throw new HttpError(400, 'El contenido JSON no es válido.');
  }
  throw new HttpError(400, 'El contenido JSON debe ser un objeto.');
}

export const cookies = request => Object.fromEntries(
  (request.headers.get('cookie') ?? '').split(';').map(part => part.trim().split('=')),
);

export const cookie = (name, value, age, origin) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;

export const statement = (db, sql, ...bindings) => db.prepare(sql).bind(...bindings);
export const first = (db, sql, ...bindings) => statement(db, sql, ...bindings).first();
export const run = (db, sql, ...bindings) => statement(db, sql, ...bindings).run();
export const list = async (db, sql, ...bindings) => (await statement(db, sql, ...bindings).all()).results;

export function redirect(location, values = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const value of values) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

import { HttpError, run } from './security.ts';

type StorageEnv = {
  DB: any;
  DOCUMENTS?: any;
  SUPABASE_URL?: string;
  SUPABASE_STORAGE_KEY?: string;
  SUPABASE_BUCKET?: string;
};

const capacity = 800_000_000;

function configuration(env: StorageEnv) {
  const { SUPABASE_URL, SUPABASE_STORAGE_KEY, SUPABASE_BUCKET } = env;
  if (!SUPABASE_URL || !SUPABASE_STORAGE_KEY || !SUPABASE_BUCKET) return null;
  const project = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.exec(SUPABASE_URL);
  if (!project || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(SUPABASE_BUCKET)) return null;
  const headers = new Headers({ apikey: SUPABASE_STORAGE_KEY });
  if (!SUPABASE_STORAGE_KEY.startsWith('sb_secret_')) {
    headers.set('Authorization', 'Bearer ' + SUPABASE_STORAGE_KEY);
  }
  return { root: SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object', name: SUPABASE_BUCKET, headers };
}

export function storageEnabled(env: StorageEnv) {
  return Boolean(configuration(env) || env.DOCUMENTS);
}

export function bucket(env: StorageEnv) {
  const config = configuration(env);
  if (!config) {
    if (env.DOCUMENTS) return env.DOCUMENTS;
    throw new HttpError(503, 'La subida de documentos aún no está habilitada.');
  }
  const { root, name, headers } = config;
  const objectPath = (key: string) => [name, ...key.split('/')].map(encodeURIComponent).join('/');
  const unavailable = () => new HttpError(503, 'El almacenamiento de archivos no está disponible ahora.');
  async function request(url: string, init: RequestInit) {
    try {
      return await fetch(url, { ...init, redirect: 'error' });
    } catch {
      throw unavailable();
    }
  }

  return {
    async put(key: string, bytes: Uint8Array) {
      const reserved = await run(env.DB, `INSERT INTO storage_reservations (object_key,bytes)
        SELECT ?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM storage_reservations)+?<=?`,
        key, bytes.byteLength, bytes.byteLength, capacity);
      if (!reserved.meta.changes) throw new HttpError(409, 'Se ha alcanzado el límite de almacenamiento gratuito.');
      const uploadHeaders = new Headers(headers);
      uploadHeaders.set('Content-Type', 'application/octet-stream');
      uploadHeaders.set('x-upsert', 'false');
      const result = await request(root + '/' + objectPath(key), { method: 'POST', headers: uploadHeaders, body: bytes });
      if (!result.ok) {
        // A gateway or server error can occur after the upload reached storage.
        if ([400, 401, 403, 404, 413, 415, 429].includes(result.status)) {
          await run(env.DB, 'DELETE FROM storage_reservations WHERE object_key=?', key);
        }
        throw unavailable();
      }
    },
    async get(key: string, options?: { range: { offset: number; length: number } }) {
      const downloadHeaders = new Headers(headers);
      if (options?.range) {
        const { offset, length } = options.range;
        downloadHeaders.set('Range', `bytes=${offset}-${offset + length - 1}`);
      }
      const result = await request(root + '/authenticated/' + objectPath(key), { method: 'GET', headers: downloadHeaders });
      if (result.status === 404) return null;
      if (!result.ok || !result.body || (options?.range && result.status !== 206)) throw unavailable();
      if (options?.range) {
        const { offset, length } = options.range;
        const expected = `bytes ${offset}-${offset + length - 1}/`;
        if (!result.headers.get('Content-Range')?.startsWith(expected)) throw unavailable();
      }
      return { body: result.body };
    },
    async delete(key: string) {
      const result = await request(root + '/' + objectPath(key), { method: 'DELETE', headers });
      if (!result.ok && result.status !== 404) throw unavailable();
      await run(env.DB, 'DELETE FROM storage_reservations WHERE object_key=?', key);
    },
  };
}

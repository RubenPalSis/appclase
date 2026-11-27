import { HttpError, first, run } from './security.ts';
import { authenticateStorage, teacherConnection, type TeacherStorageEnv } from './teacher-storage.ts';

type StorageEnv = TeacherStorageEnv & {
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

type Course = { teacher_id: string; id: string };
type StoreConfig = { root: string; name: string; headers: Headers; connectionId?: string; scope?: string };

export async function storageEnabled(env: StorageEnv, course: Course) {
  if (configuration(env) || env.DOCUMENTS) return true;
  const personal = await teacherConnection(env.DB, course.teacher_id);
  if (personal && env.STORAGE_ENCRYPTION_KEY) return true;
  return Boolean(env.STORAGE_ENCRYPTION_KEY && await first(env.DB, `SELECT 1 FROM storage_reservations r
    JOIN teacher_storage_connections c ON c.id=r.connection_id WHERE r.object_key GLOB ? LIMIT 1`, course.id + '/*'));
}

export function bucket(env: StorageEnv, course: Course) {
  async function resolve(key: string, operation: 'put'|'get'|'delete') {
    const connection = operation === 'put'
      ? await teacherConnection(env.DB, course.teacher_id)
      : await first(env.DB, `SELECT c.id,c.origin,c.bucket,c.credential FROM storage_reservations r
          JOIN teacher_storage_connections c ON c.id=r.connection_id WHERE r.object_key=?`, key);
    if (connection) {
      let headers;
      try { headers = await authenticateStorage(env,connection); }
      catch { throw new HttpError(503, 'La conexión privada del profesor no está disponible.'); }
      return supabase(env, {
        root:connection.origin + '/storage/v1/object',name:connection.bucket,headers,
        connectionId:connection.id,scope:connection.origin,
      });
    }
    const config = configuration(env);
    if (config) return supabase(env,config);
    if (env.DOCUMENTS) return env.DOCUMENTS;
    throw new HttpError(503, 'La subida de documentos aún no está habilitada.');
  }
  return {
    put: async (key: string, bytes: Uint8Array) => (await resolve(key,'put')).put(key,bytes),
    get: async (key: string, options?: { range: { offset: number; length: number } }) => (await resolve(key,'get')).get(key,options),
    delete: async (key: string) => (await resolve(key,'delete')).delete(key),
  };
}

function supabase(env: StorageEnv, config: StoreConfig) {
  const { root, name, headers, connectionId = null, scope = 'global' } = config;
  const objectPath = (key: string) => [name, ...key.split('/')].map(encodeURIComponent).join('/');
  const unavailable = () => new HttpError(503, 'El almacenamiento de archivos no está disponible ahora.');
  async function request(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.method === 'POST' ? 90000 : 15000);
    try {
      return await fetch(url, { ...init, redirect: 'error', signal:controller.signal });
    } catch {
      throw unavailable();
    } finally {
      // Stop timing out once the upstream headers arrive. Video streams can take longer.
      clearTimeout(timeout);
    }
  }

  return {
    async put(key: string, bytes: Uint8Array) {
      const reserved = await run(env.DB, `INSERT INTO storage_reservations (object_key,bytes,connection_id,quota_scope)
        SELECT ?,?,?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM storage_reservations WHERE quota_scope=?)+?<=?`,
        key, bytes.byteLength, connectionId, scope, scope, bytes.byteLength, capacity);
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

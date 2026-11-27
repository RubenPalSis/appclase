import { limit, readEmail } from './auth.ts';
import { HttpError, first, hash, statement, text } from './security.ts';

export type TeacherStorageEnv = { DB: any; STORAGE_ENCRYPTION_KEY?: string };
type Credentials = { email: string; password: string; apiKey: string };
type Connection = { id: string; origin: string; bucket: string; credential: string };

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

function keyBytes(env: TeacherStorageEnv) {
  try {
    const bytes = decode(env.STORAGE_ENCRYPTION_KEY ?? '');
    return bytes.byteLength === 32 ? bytes : null;
  } catch { return null; }
}

async function key(env: TeacherStorageEnv) {
  const bytes = keyBytes(env);
  if (!bytes) throw new HttpError(503, 'APPCLASE aún no ha activado las conexiones personales.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}

const context = (connection: Pick<Connection,'id'|'origin'|'bucket'>) =>
  new TextEncoder().encode(JSON.stringify([connection.id, connection.origin, connection.bucket]));

async function protect(env: TeacherStorageEnv, connection: Omit<Connection,'credential'>, credentials: Credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:context(connection) },
    await key(env), new TextEncoder().encode(JSON.stringify(credentials)));
  return encode(iv) + '.' + encode(new Uint8Array(cipher));
}

const sessions = new Map<string, { credential: string; expires: number; headers: Headers }>();

export async function authenticateStorage(env: TeacherStorageEnv, connection: Connection) {
  const cached = sessions.get(connection.id);
  if (cached && cached.credential === connection.credential && cached.expires > Date.now()) return cached.headers;
  const [iv, cipher] = connection.credential.split('.');
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:decode(iv), additionalData:context(connection) },
    await key(env), decode(cipher));
  const session = await login(connection.origin, JSON.parse(new TextDecoder().decode(plain)) as Credentials);
  if (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
  sessions.set(connection.id, {credential:connection.credential, ...session});
  return session.headers;
}

async function login(origin: string, credentials: Credentials) {
  const response = await fetch(origin + '/auth/v1/token?grant_type=password', {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
    headers:{ apikey:credentials.apiKey, 'Content-Type':'application/json' },
    body:JSON.stringify({email:credentials.email,password:credentials.password}),
  });
  if (!response.ok) throw new HttpError(400, 'Supabase rechazó el acceso de la cuenta técnica.');
  const {access_token, expires_in} = await response.json() as {access_token?:string;expires_in?:number};
  if (typeof access_token !== 'string' || !access_token) throw new HttpError(400, 'Supabase no devolvió una sesión válida.');
  return {
    headers:new Headers({ apikey:credentials.apiKey, Authorization:'Bearer ' + access_token }),
    expires:Date.now() + Math.max(0, Math.min(300, Number(expires_in) - 30)) * 1000,
  };
}

export const teacherConnection = (db, teacher: string) =>
  first(db, 'SELECT id,origin,bucket,credential FROM teacher_storage_connections WHERE teacher_id=? AND active=1', teacher);

async function requireTeacher(db, user) {
  const role = await first(db, "SELECT 1 FROM memberships WHERE user_id=? AND active=1 AND role IN ('teacher','admin') LIMIT 1", user.id);
  if (!role) throw new HttpError(403, 'Solo el personal docente puede conectar almacenamiento.');
}

export async function storageProfile(env: TeacherStorageEnv, user) {
  await requireTeacher(env.DB, user);
  const connection = await teacherConnection(env.DB, user.id);
  return { available:Boolean(keyBytes(env)), connection:connection ? {origin:connection.origin,bucket:connection.bucket} : null };
}

async function verifyBucket(origin: string, bucket: string, headers: Headers) {
  const root = origin + '/storage/v1';
  const request = (path: string, init: RequestInit = {}) =>
    fetch(root + path, { ...init, redirect:'error',signal:AbortSignal.timeout(10000) });
  const info = await request('/bucket/' + bucket, { headers });
  if (!info.ok || (await info.json() as {public?:boolean}).public !== false) {
    throw new HttpError(400, 'El bucket debe ser privado y la cuenta técnica debe poder consultarlo.');
  }
  const object = bucket + '/appclase/conexion-' + crypto.randomUUID() + '.txt';
  const upload = new Headers(headers);
  upload.set('Content-Type','application/octet-stream');
  upload.set('x-upsert','false');
  const created = await request('/object/' + object,{method:'POST',headers:upload,body:'APPCLASE'});
  if (!created.ok) throw new HttpError(400, 'La cuenta técnica no puede subir archivos a este bucket.');
  try {
    const saved = await request('/object/authenticated/' + object,{headers});
    if (!saved.ok || await saved.text() !== 'APPCLASE') throw new HttpError(400, 'La cuenta técnica no puede leer los archivos.');
    const anonymous = await request('/object/public/' + object);
    if (anonymous.ok) throw new HttpError(400, 'El archivo de prueba está disponible públicamente.');
  } finally {
    const deleted = await request('/object/' + object,{method:'DELETE',headers});
    if (!deleted.ok) throw new HttpError(400, 'La cuenta técnica no puede retirar el archivo de prueba.');
  }
}

export async function connectTeacherStorage(env: TeacherStorageEnv, user, data) {
  await requireTeacher(env.DB, user);
  if (!keyBytes(env)) throw new HttpError(503, 'APPCLASE aún no ha activado las conexiones personales.');
  await limit(env.DB, await hash('teacher-storage:' + user.id), 10, 3600);
  const origin = text(data.origin, 100).replace(/\/$/,'');
  const bucket = text(data.bucket, 63);
  const apiKey = text(data.api_key, 300);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket) ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new HttpError(400, 'Introduce la URL de Supabase, un bucket válido y una clave publicable.');
  }
  if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 256) {
    throw new HttpError(400, 'Usa una contraseña técnica de al menos 12 caracteres.');
  }
  const existing = await first(env.DB, 'SELECT id,teacher_id FROM teacher_storage_connections WHERE origin=? AND bucket=?', origin,bucket);
  if (existing && existing.teacher_id !== user.id) throw new HttpError(409, 'Ese bucket ya está vinculado a otra cuenta.');
  const credentials = {email:readEmail(data.email),password:data.password,apiKey};
  const connection = {id:existing?.id ?? crypto.randomUUID(),origin,bucket};
  try {
    await verifyBucket(origin,bucket,(await login(origin,credentials)).headers);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'No se ha podido comprobar la conexión con Supabase.');
  }
  const credential = await protect(env, connection,credentials);
  try {
    await env.DB.batch([
      statement(env.DB, 'UPDATE teacher_storage_connections SET active=0 WHERE teacher_id=? AND active=1', user.id),
      statement(env.DB, `INSERT INTO teacher_storage_connections (id,teacher_id,origin,bucket,credential,active)
        VALUES (?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential,active=1`,
        connection.id,user.id,origin,bucket,credential),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'El bucket acaba de vincularse. Comprueba la conexión y vuelve a intentarlo.');
    throw error;
  }
  return storageProfile(env,user);
}

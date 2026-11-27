import { HttpError, cookie, cookies, first, hash, now, run, statement, text, token } from './security.js';

const sessionAge = 43200;

export async function currentUser(request, env) {
  const session = cookies(request).appclase_session;
  if (!session || !/^[a-f0-9]{64}$/.test(session)) {
    throw new HttpError(401, 'Inicia sesión para continuar.');
  }
  const user = await first(env.DB, `
    SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON s.user_id=u.id
    WHERE s.hash=? AND s.expires>?`, await hash(session), now());
  if (!user) throw new HttpError(401, 'La sesión ha caducado.');
  return user;
}

export async function logout(request, env, origin) {
  const session = cookies(request).appclase_session;
  if (session) await run(env.DB, 'DELETE FROM sessions WHERE hash=?', await hash(session));
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': cookie('appclase_session', '', 0, origin), 'Cache-Control': 'no-store' },
  });
}

const iterations = 100000;

async function derive(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-512', salt: encoder.encode(salt), iterations,
  }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function equals(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function limit(db, key, maximum, window) {
  const current = Math.floor(now() / window) * window;
  const row = await first(db, `INSERT INTO login_limits VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,
    window=excluded.window RETURNING attempts`, key, current);
  if (row.attempts > maximum) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
}

export async function authenticate(request, env, origin, data, register) {
  const db = env.DB;
  const email = text(data.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Introduce un correo válido.');
  const password = data.password;
  if (typeof password !== 'string' || password.length > 128 || password.length < (register ? 12 : 1)) {
    throw new HttpError(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const source = request.headers.get('CF-Connecting-IP') || 'local';
  await limit(db, await hash((register ? 'register:' : 'login:') + source), register ? 15 : 80, 900);
  if (!register) await limit(db, await hash('email:' + email), 12, 900);

  const existing = await first(db, `SELECT u.id,c.salt,c.digest FROM users u LEFT JOIN password_credentials c ON c.user_id=u.id
    WHERE u.email=?`, email);
  const session = token();
  const timestamp = now();
  const commands = [];
  let id;
  if (register) {
    if (existing) throw new HttpError(409, 'No se puede registrar esta cuenta.');
    id = crypto.randomUUID();
    const salt = token();
    commands.push(
      statement(db, 'INSERT INTO users VALUES (?,?,?)', id, email, text(data.name, 160)),
      statement(db, 'INSERT INTO password_credentials VALUES (?,?,?)', id, salt, await derive(password, salt)),
    );
  } else {
    const computed = await derive(password, existing?.salt || 'appclase-unknown-account');
    if (!equals(computed, existing?.digest || '') || !existing) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    id = existing.id;
  }
  const old = cookies(request).appclase_session;
  commands.push(
    statement(db, 'DELETE FROM sessions WHERE hash=? OR hash IN (SELECT hash FROM sessions WHERE expires<=? LIMIT 100)',
      old ? await hash(old) : '', timestamp),
    statement(db, 'INSERT INTO sessions VALUES (?,?,?)', await hash(session), id, timestamp + sessionAge),
    statement(db, 'DELETE FROM login_limits WHERE key IN (SELECT key FROM login_limits WHERE window<? LIMIT 20)', timestamp - 3600),
  );
  await db.batch(commands);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': cookie('appclase_session', session, sessionAge, origin), 'Cache-Control': 'no-store' },
  });
}

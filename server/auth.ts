import { HttpError, cookie, cookies, first, hash, now, run, statement, text, token } from './security.ts';

const sessionAge = 43200;

export async function currentUser(request, env) {
  const session = cookies(request).appclase_session;
  if (!session || !/^[a-f0-9]{64}$/.test(session)) {
    throw new HttpError(401, 'Inicia sesión para continuar.');
  }
  const user = await first(env.DB, `
    SELECT u.id,u.email,u.name,COALESCE(c.must_change,0) AS must_change FROM sessions s JOIN users u ON s.user_id=u.id
    LEFT JOIN password_credentials c ON c.user_id=u.id
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

export async function limit(db, key, maximum, window) {
  const current = Math.floor(now() / window) * window;
  const row = await first(db, `INSERT INTO login_limits VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,
    window=excluded.window RETURNING attempts`, key, current);
  if (row.attempts > maximum) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
}

export async function authenticate(request, env, origin, data, register) {
  const db = env.DB;
  const email = readEmail(data.email);
  const password = data.password;
  if (typeof password !== 'string' || password.length > 128 || password.length < (register ? 12 : 1)) {
    throw new HttpError(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const source = request.headers.get('CF-Connecting-IP') || 'local';
  await limit(db, await hash((register ? 'register:' : 'login:') + source), register ? 15 : 80, 900);
  if (!register) await limit(db, await hash('email:' + email), 12, 900);

  const existing = await first(db, `SELECT u.id,c.salt,c.digest,c.must_change FROM users u LEFT JOIN password_credentials c ON c.user_id=u.id
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
      statement(db, 'INSERT INTO password_credentials (user_id,salt,digest) VALUES (?,?,?)', id, salt, await derive(password, salt)),
    );
  } else {
    const computed = await derive(password, existing?.salt || 'appclase-unknown-account');
    if (!equals(computed, existing?.digest || '') || !existing) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    if (existing.must_change) {
      const code = typeof data.center_code === 'string' ? data.center_code.trim().toUpperCase() : '';
      const center = await first(db, `SELECT o.id FROM memberships m JOIN organizations o ON o.id=m.org_id
        WHERE m.user_id=? AND m.role='teacher' AND m.active=1 AND o.access_code=?`, existing.id, code);
      if (!center) throw new HttpError(401, 'Introduce el código de cuatro caracteres de tu centro.');
    }
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

export function readEmail(value) {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Introduce un correo válido.');
  return email;
}

export async function passwordRecord(password) {
  const salt = token();
  return { salt, digest: await derive(password, salt) };
}

export async function activatePassword(request, env, user, data) {
  if (!user.must_change) throw new HttpError(409, 'La cuenta ya está activada.');
  const password = data.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const db = env.DB;
  const credential = await first(db, 'SELECT salt,digest FROM password_credentials WHERE user_id=?', user.id);
  if (equals(await derive(password, credential.salt), credential.digest)) {
    throw new HttpError(400, 'Elige una contraseña distinta a la temporal.');
  }
  const { salt, digest } = await passwordRecord(password);
  const sessionHash = await hash(cookies(request).appclase_session);
  await db.batch([
    statement(db, 'UPDATE password_credentials SET salt=?,digest=?,must_change=0 WHERE user_id=? AND must_change=1', salt, digest, user.id),
    statement(db, 'DELETE FROM sessions WHERE user_id=? AND hash<>?', user.id, sessionHash),
  ]);
  return {};
}

export async function changePassword(request, env, user, data) {
  const current = data.current_password;
  const password = data.password;
  if (user.must_change) throw new HttpError(403, 'Activa tu cuenta antes de cambiar la contraseña.');
  if (typeof current !== 'string' || current.length > 128 || typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'La contraseña nueva debe tener entre 12 y 128 caracteres.');
  }
  const db = env.DB;
  const credential = await first(db, 'SELECT salt,digest FROM password_credentials WHERE user_id=?', user.id);
  if (!credential || !equals(await derive(current, credential.salt), credential.digest)) {
    throw new HttpError(401, 'La contraseña actual no es correcta.');
  }
  if (equals(await derive(password, credential.salt), credential.digest)) {
    throw new HttpError(400, 'Elige una contraseña distinta a la actual.');
  }
  const { salt, digest } = await passwordRecord(password);
  const sessionHash = await hash(cookies(request).appclase_session);
  await db.batch([
    statement(db, 'UPDATE password_credentials SET salt=?,digest=? WHERE user_id=?', salt, digest, user.id),
    statement(db, "DELETE FROM password_resets WHERE user_id=?", user.id),
    statement(db, 'DELETE FROM sessions WHERE user_id=? AND hash<>?', user.id, sessionHash),
  ]);
  return {};
}

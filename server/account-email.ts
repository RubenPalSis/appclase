import { limit, passwordRecord, readEmail } from './auth.ts';
import { HttpError, first, hash, now, run, statement, token } from './security.ts';

export const emailEnabled = env => Boolean(env.RESEND_API_KEY && env.ACCOUNT_EMAIL_FROM && env.APP_ORIGIN);

export async function requestPasswordReset(request, env, emailValue) {
  if (!emailEnabled(env)) throw new HttpError(503, 'El correo de APPCLASE todavía no está configurado.');
  const email = readEmail(emailValue);
  const db = env.DB;
  const source = request.headers.get('CF-Connecting-IP') || 'local';
  await limit(db, await hash('mail-ip:' + source), 15, 3600);
  await limit(db, await hash('mail-address:' + email), 4, 3600);
  const user = await first(db, `SELECT u.id,c.must_change FROM users u
    JOIN password_credentials c ON c.user_id=u.id WHERE u.email=?`, email);
  if (!user || user.must_change) return {};
  const value = token();
  const digest = await hash(value);
  await run(db, `INSERT INTO password_resets VALUES (?,?,?) ON CONFLICT(user_id)
    DO UPDATE SET hash=excluded.hash,expires=excluded.expires`, digest, user.id, now() + 1800);
  const next = new URL('/', env.APP_ORIGIN);
  next.hash = new URLSearchParams({ action: 'reset', token: value }).toString();
  const subject = 'Restablece tu contraseña de APPCLASE';
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.ACCOUNT_EMAIL_FROM, to: [email], subject,
        text: subject + '\n\n' + next.href + '\n\nEl enlace caduca en 30 minutos. Si no lo solicitaste, ignora este mensaje.' }),
    });
    if (!result.ok) throw Error('El proveedor rechazó el envío.');
  } catch {
    await run(db, 'DELETE FROM password_resets WHERE hash=?', digest);
    console.error('No se pudo enviar el correo de cuenta de APPCLASE.');
  }
  return {};
}

export async function completePasswordReset(env, data) {
  const invalid = () => new HttpError(400, 'El enlace ya se usó o ha caducado.');
  if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw invalid();
  if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128) {
    throw new HttpError(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const digest = await hash(data.token);
  const db = env.DB;
  const action = await first(db, 'SELECT user_id FROM password_resets WHERE hash=? AND expires>?', digest, now());
  if (!action) throw invalid();
  const { salt, digest: passwordHash } = await passwordRecord(data.password);
  const allowed = 'EXISTS(SELECT 1 FROM password_resets WHERE hash=? AND expires>unixepoch())';
  const [updated] = await db.batch([
    statement(db, 'UPDATE password_credentials SET salt=?,digest=? WHERE user_id=? AND must_change=0 AND ' + allowed,
      salt, passwordHash, action.user_id, digest),
    statement(db, 'DELETE FROM sessions WHERE user_id=? AND ' + allowed, action.user_id, digest),
    statement(db, 'DELETE FROM password_resets WHERE hash=?', digest),
  ]);
  if (!updated.meta.changes) throw invalid();
  return {};
}

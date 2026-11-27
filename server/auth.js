import { HttpError, cookie, cookies, first, hash, now, redirect, run, statement, token } from './security.js';

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

export async function oauth(request, env, url, origin) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.APP_ORIGIN || url.origin !== origin) {
    throw new HttpError(503, 'El acceso con Google aún no está configurado en este entorno.');
  }
  const callback = origin + '/api/auth/callback';
  if (url.pathname === '/api/auth/google') {
    const state = token();
    const verifier = token();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code',
      scope: 'openid email profile', state, code_challenge: await hash(verifier), code_challenge_method: 'S256',
    });
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params, [
      cookie('appclase_oauth', state + '.' + verifier, 600, origin),
    ]);
  }

  const [state, verifier] = (cookies(request).appclase_oauth ?? '').split('.');
  const code = url.searchParams.get('code');
  const clear = cookie('appclase_oauth', '', 0, origin);
  if (!verifier || !code || state !== url.searchParams.get('state')) {
    return redirect('/?acceso=cancelado', [clear]);
  }
  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callback, grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  if (!exchange.ok) return redirect('/?acceso=cancelado', [clear]);
  const { access_token: accessToken } = await exchange.json();
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) return redirect('/?acceso=cancelado', [clear]);
  const profile = await response.json();
  if (profile.email_verified !== true || typeof profile.sub !== 'string' || typeof profile.email !== 'string') {
    return redirect('/?acceso=cancelado', [clear]);
  }
  const session = token();
  const old = cookies(request).appclase_session;
  const commands = [
    statement(env.DB, `INSERT INTO users (id,email,name) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name`,
      profile.sub, profile.email.toLowerCase(), String(profile.name || profile.email).slice(0, 160)),
    statement(env.DB, 'DELETE FROM sessions WHERE hash=? OR hash IN (SELECT hash FROM sessions WHERE expires<=? LIMIT 100)', old ? await hash(old) : '', now()),
    statement(env.DB, 'INSERT INTO sessions VALUES (?,?,?)', await hash(session), profile.sub, now() + sessionAge),
  ];
  await env.DB.batch(commands);
  return redirect('/', [clear, cookie('appclase_session', session, sessionAge, origin)]);
}

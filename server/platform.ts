import { audit } from './classes.ts';
import { passwordRecord, readEmail } from './auth.ts';
import { HttpError, first, list, statement, text } from './security.ts';

const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)),
    byte => alphabet[byte & 31]).join('');
}

export async function isPlatformAdmin(db, user) {
  return Boolean(await first(db, 'SELECT user_id FROM platform_administrators WHERE user_id=?', user.id));
}

export async function centers(db, user) {
  if (!await isPlatformAdmin(db, user)) throw new HttpError(403, 'Se requiere administración de plataforma.');
  return list(db, `SELECT o.id,o.name,o.access_code,
    (SELECT COUNT(*) FROM teachers t WHERE t.organization_id=o.id AND t.active=1) AS teachers,
    (SELECT COUNT(*) FROM students s WHERE s.organization_id=o.id AND s.active=1) AS students
    FROM organizations o ORDER BY o.name,o.id`);
}

export async function createCenter(db, user, data) {
  if (!await isPlatformAdmin(db, user)) throw new HttpError(403, 'Se requiere administración de plataforma.');
  const name = text(data.name, 120);
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = crypto.randomUUID();
    const code = randomCode(4);
    try {
      await db.batch([
        statement(db, 'INSERT INTO organizations (id,name,access_code) VALUES (?,?,?)', id, name, code),
        statement(db, "INSERT INTO memberships (org_id,user_id,role) SELECT ?,user_id,'admin' FROM platform_administrators", id),
        audit(db, id, user.id, 'organization.created', id),
      ]);
      return { id, name, access_code: code };
    } catch (error) {
      if (!String(error).includes('organizations.access_code')) throw error;
    }
  }
  throw new HttpError(503, 'No se pudo emitir un código. Vuelve a intentarlo.');
}

export async function provisionTeacher(db, user, center, data) {
  const email = readEmail(data.email);
  const name = text(data.name, 160);
  const id = crypto.randomUUID();
  const password = randomCode(16);
  const { salt, digest } = await passwordRecord(password);
  if (await first(db, 'SELECT id FROM users WHERE email=?', email)) {
    throw new HttpError(409, 'Ese correo ya tiene una cuenta. Puedes darle acceso por ID.');
  }
  if (!center.access_code) throw new HttpError(409, 'Este centro necesita un código de acceso.');
  await db.batch([
    statement(db, 'INSERT INTO users VALUES (?,?,?)', id, email, name),
    statement(db, 'INSERT INTO password_credentials (user_id,salt,digest,must_change) VALUES (?,?,?,1)', id, salt, digest),
    statement(db, "INSERT INTO memberships (org_id,user_id,role) VALUES (?,?,'teacher')", center.id, id),
    audit(db, center.id, user.id, 'teacher.provisioned', id),
  ]);
  return { name, email, password, access_code: center.access_code };
}

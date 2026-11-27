import { audit } from './classes.js';
import { HttpError, first, list, statement, text } from './security.js';

export async function requireAdmin(db, user, org) {
  const membership = await first(db, `SELECT o.id,o.name FROM organizations o
    JOIN memberships m ON m.org_id=o.id
    WHERE o.id=? AND m.user_id=? AND m.role='admin' AND m.active=1`, org, user.id);
  if (!membership) throw new HttpError(404, 'No se encuentra el centro o no tienes permisos.');
  return membership;
}

export function members(db, org) {
  return list(db, `SELECT u.id,u.name,u.email,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.org_id=? ORDER BY m.active DESC,u.name,u.id LIMIT 100`, org);
}

export function logs(db, org) {
  return list(db, `SELECT a.action,a.target,a.created,u.name AS actor FROM audit_logs a JOIN users u ON a.actor=u.id
    WHERE a.org_id=? ORDER BY a.created DESC,a.id DESC LIMIT 100`, org);
}

export async function updateMembership(db, user, org, data) {
  if (!['teacher','student'].includes(data.role) || typeof data.active !== 'boolean') {
    throw new HttpError(400, 'Elige el rol y el estado de acceso.');
  }
  const id = text(data.user_id, 100);
  const target = await first(db, `SELECT u.id,m.role FROM users u LEFT JOIN memberships m ON m.org_id=? AND m.user_id=u.id
    WHERE u.id=?`, org, id);
  if (!target) throw new HttpError(404, 'La persona debe haber creado su cuenta antes.');
  if (target.role === 'admin' || target.id === user.id) throw new HttpError(403, 'Los permisos de administrador se gestionan fuera del panel.');
  await db.batch([
    statement(db, `INSERT INTO memberships (org_id,user_id,role,active) VALUES (?,?,?,?)
      ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role,active=excluded.active WHERE memberships.role<>'admin'`,
    org, target.id, data.role, Number(data.active)),
    audit(db, org, user.id, data.active ? 'membership.enabled' : 'membership.disabled', target.id),
  ]);
  return {};
}

export async function rename(db, user, org, data) {
  await db.batch([
    statement(db, 'UPDATE organizations SET name=? WHERE id=?', text(data.name, 120), org),
    audit(db, org, user.id, 'organization.renamed', org),
  ]);
  return {};
}

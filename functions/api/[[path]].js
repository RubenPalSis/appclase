import * as messages from '../../server/messages.js';
import * as calendar from '../../server/calendar.js';
import * as grades from '../../server/grades.js';
import * as files from '../../server/documents.js';
import * as administration from '../../server/administration.js';
import { currentUser, logout, oauth } from '../../server/auth.js';
import * as classes from '../../server/classes.js';
import * as exams from '../../server/exams.js';
import * as learning from '../../server/learning.js';
import { HttpError, jsonBody, list } from '../../server/security.js';

const response = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : url.origin;
    const { method } = request;
    const parts = url.pathname.split('/').slice(2);
    if (method !== 'GET' && (method !== 'POST' || request.headers.get('origin') !== origin || url.origin !== origin)) {
      throw new HttpError(403, 'Origen de solicitud no autorizado.');
    }
    if (method === 'GET' && ['/api/auth/google','/api/auth/callback'].includes(url.pathname)) {
      return await oauth(request, env, url, origin);
    }
    const user = await currentUser(request, env);
    const db = env.DB;
    if (url.pathname === '/api/logout' && method === 'POST') return await logout(request, env, origin);
    if (url.pathname === '/api/me' && method === 'GET') return response({ user, organizations: await classes.organizations(db, user) });
    if (url.pathname === '/api/join' && method === 'POST') return response(await classes.joinClass(db, user, await jsonBody(request)));
    if (url.pathname === '/api/classes') return response(method === 'GET'
      ? await classes.visibleClasses(db, user)
      : await classes.createClass(db, user, await jsonBody(request)));
    if (parts[0] === 'organizations' && parts.length === 3) {
      const org = await administration.requireAdmin(db, user, parts[1]);
      switch (parts[2]) {
        case 'members': return response(method === 'GET'
          ? await administration.members(db, org.id)
          : await administration.updateMembership(db, user, org.id, await jsonBody(request)));
        case 'reports': if (method === 'GET') return response(await messages.reports(db, org.id)); break;
        case 'audit': if (method === 'GET') return response(await administration.logs(db, org.id)); break;
        case 'settings': return response(method === 'GET'
          ? org : await administration.rename(db, user, org.id, await jsonBody(request)));
      }
    }
    if (parts[0] !== 'classes' || !parts[1]) throw new HttpError(404, 'Ruta no disponible.');
    const course = await classes.classAccess(db, parts[1], user);
    const section = parts[2];
    if (parts.length === 2 && method === 'GET') return response({ ...course, documents_enabled: Boolean(env.DOCUMENTS) });
    if (section === 'documents' && parts.length === 4 && method === 'GET') {
      return await files.download(env, course, parts[3]);
    }
    if (section === 'documents' && parts.length === 3) {
      return response(method === 'GET'
        ? await files.documents(db, course)
        : await files.upload(env, course, request, url.searchParams.get('name')));
    }
    if (section === 'messages') {
      if (parts.length === 3 && method === 'GET') return response(await messages.threads(db, course, user));
      if (parts.length === 4) return response(method === 'GET'
        ? await messages.thread(db, course, user, parts[3])
        : await messages.send(db, course, user, parts[3], await jsonBody(request)));
      if (parts.length === 5 && method === 'POST') {
        if (parts[4] === 'read') return response(await messages.markRead(db, course, user, parts[3], await jsonBody(request)));
        if (parts[4] === 'report') return response(await messages.report(db, course, user, parts[3], await jsonBody(request)));
      }
    }
    if (parts.length === 5 && section === 'assignments') {
      const [, , , id, action] = parts;
      if (action === 'deliver' && method === 'POST') return response(await learning.deliver(db, course, user, id, await jsonBody(request)));
      if (action === 'reviews' && method === 'GET') return response(await learning.reviews(db, course, id));
      if (action === 'reviews' && method === 'POST') return response(await learning.grade(db, course, id, await jsonBody(request)));
    }
    if (section === 'exams' && parts.length === 5) {
      const [, , , id, action] = parts;
      if (method === 'GET' && action === 'attempts') return response(await exams.attempts(db, course, user, id));
      if (method === 'POST' && action === 'start') return response(await exams.startExam(db, course, user, id));
      if (method === 'POST') return response(await exams.saveExam(db, course, user, id, action, await jsonBody(request)));
    }
    if (parts.length === 4 && method === 'GET' && parts[3] === 'export') {
      if (section === 'calendar') return await calendar.downloadCalendar(db, course, url);
      if (section === 'grades') return await grades.exportGrades(db, course);
    }
    if (parts.length === 3 && method === 'GET') {
      switch (section) {
        case 'calendar': return response(await calendar.events(db, course, url));
        case 'grades': return response(await grades.gradeRows(db, course, user));
        case 'posts': return response(await list(db, `SELECT p.*,u.name AS author FROM posts p
          JOIN users u ON u.id=p.author_id WHERE p.class_id=? ORDER BY p.created DESC,p.id DESC LIMIT 100`, course.id));
        case 'materials': return response(await list(db, 'SELECT * FROM materials WHERE class_id=? ORDER BY created DESC,id DESC LIMIT 100', course.id));
        case 'exams': return response(await exams.examList(db, course, user));
        case 'assignments': return response(await learning.assignments(db, course, user));
        case 'students': return response(await learning.students(db, course));
        case 'attendance': return response(await learning.attendance(db, course, user, url.searchParams.get('day')));
      }
    }
    if (parts.length === 3 && method === 'POST') {
      const data = await jsonBody(request);
      switch (section) {
        case 'calendar': return response(await calendar.addEvent(db, course, data));
        case 'posts': return response(await classes.createPost(db, course, user, data));
        case 'materials': return response(await classes.createMaterial(db, course, data));
        case 'exams': return response(await exams.createExam(db, course, data));
        case 'assignments': return response(await learning.addAssignment(db, course, data));
        case 'attendance': return response(await learning.markAttendance(db, course, data));
        case 'archive': return response(await classes.archive(db, course, user, data));
        case 'invite': return response(await classes.invite(db, course, user));
      }
    }
    throw new HttpError(404, 'Ruta no disponible.');
  } catch (error) {
    if (error instanceof HttpError) return response({ error: error.message }, error.status);
    console.error('APPCLASE API', error.name);
    return response({ error: 'No se ha podido completar la operación.' }, 500);
  }
}

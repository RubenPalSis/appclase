import * as lessons from '../../server/lessons.ts';
import { completePasswordReset, emailEnabled, requestPasswordReset } from '../../server/account-email.ts';
import * as platform from '../../server/platform.ts';
import * as materials from '../../server/materials.ts';
import { pendingReviews, upcoming } from '../../server/dashboard.ts';
import * as board from '../../server/board.ts';
import * as notices from '../../server/notifications.ts';
import * as messages from '../../server/messages.ts';
import * as calendar from '../../server/calendar.ts';
import * as grades from '../../server/grades.ts';
import * as files from '../../server/documents.ts';
import * as administration from '../../server/administration.ts';
import { activatePassword, authenticate, changePassword, currentUser, logout } from '../../server/auth.ts';
import * as classes from '../../server/classes.ts';
import * as exams from '../../server/exams.ts';
import * as learning from '../../server/learning.ts';
import { HttpError, jsonBody } from '../../server/security.ts';

const response = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

type Env = { DB: any; APP_ORIGIN?: string; DOCUMENTS?: any; RESEND_API_KEY?: string; ACCOUNT_EMAIL_FROM?: string };
export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    const url = new URL(request.url);
    const origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : url.origin;
    const { method } = request;
    const parts = url.pathname.split('/').slice(2);
    if (method !== 'GET' && (method !== 'POST' || request.headers.get('origin') !== origin || url.origin !== origin)) {
      throw new HttpError(403, 'Origen de solicitud no autorizado.');
    }
    if (method === 'POST' && ['/api/auth/login','/api/auth/register'].includes(url.pathname)) {
      return await authenticate(request, env, origin, await jsonBody(request), url.pathname.endsWith('/register'));
    }
    if (url.pathname === '/api/auth/options' && method === 'GET') return response({ email: emailEnabled(env) });
    if (url.pathname === '/api/auth/reset-request' && method === 'POST') {
      return response(await requestPasswordReset(request, env, (await jsonBody(request)).email));
    }
    if (method === 'POST' && url.pathname === '/api/auth/reset') {
      return response(await completePasswordReset(env, await jsonBody(request)));
    }
    const user = await currentUser(request, env);
    const db = env.DB;
    if (url.pathname === '/api/logout' && method === 'POST') return await logout(request, env, origin);
    if (url.pathname === '/api/me' && method === 'GET') return response(user.must_change ? {user, organizations: []} : {
      user, organizations: await classes.organizations(db, user), platform_admin: await platform.isPlatformAdmin(db, user),
    });
    if (url.pathname === '/api/auth/activate' && method === 'POST') {
      return response(await activatePassword(request, env, user, await jsonBody(request)));
    }
    if (url.pathname === '/api/auth/password' && method === 'POST') {
      return response(await changePassword(request, env, user, await jsonBody(request)));
    }
    if (user.must_change) throw new HttpError(403, 'Cambia tu contraseña temporal para continuar.');
    if (url.pathname === '/api/organizations') return response(method === 'GET'
      ? await platform.centers(db, user) : await platform.createCenter(db, user, await jsonBody(request)));
    if (url.pathname === '/api/notifications' && method === 'GET') return response(await notices.notifications(db, user));
    if (url.pathname === '/api/notifications/read' && method === 'POST') {
      return response(await notices.readNotification(db, user, (await jsonBody(request)).id));
    }
    if (url.pathname === '/api/notifications/preferences') return response(method === 'GET'
      ? await notices.preferences(db, user)
      : await notices.setPreference(db, user, await jsonBody(request)));
    if (url.pathname === '/api/dashboard/reviews' && method === 'GET') return response(await pendingReviews(db, user));
    if (url.pathname === '/api/dashboard/upcoming' && method === 'GET') return response(await upcoming(db, user, url.searchParams.get('period') === 'week'));
    if (url.pathname === '/api/join' && method === 'POST') return response(await classes.joinClass(db, user, await jsonBody(request)));
    if (url.pathname === '/api/classes') return response(method === 'GET'
      ? await classes.visibleClasses(db, user)
      : await classes.createClass(db, user, await jsonBody(request)));
    if (parts[0] === 'organizations' && parts.length === 3) {
      const org = await administration.requireAdmin(db, user, parts[1]);
      switch (parts[2]) {
        case 'teachers': if (method === 'POST') return response(await platform.provisionTeacher(db, user, org, await jsonBody(request))); break;
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
    if (section === 'students' && parts.length === 4 && parts[3] === 'import' && method === 'POST') {
      return response(await classes.importStudents(db, course, user, await jsonBody(request)));
    }
    if (parts.length === 2 && method === 'GET') return response({ ...course, documents_enabled: Boolean(env.DOCUMENTS) });
    if (section === 'topics' && parts.length === 4 && method === 'POST') {
      return response(await materials.moveTopic(db, course, parts[3], await jsonBody(request)));
    }
    if (section === 'documents' && parts.length === 4 && method === 'GET') {
      return await files.download(env, course, parts[3]);
    }
    if (section === 'documents' && parts.length === 3) {
      return response(method === 'GET'
        ? await files.documents(db, course)
        : await files.upload(env, course, request, url.searchParams.get('name')));
    }
    if (section === 'posts' && parts.length === 5) {
      const [, , , id, action] = parts;
      if (action === 'comments') return response(method === 'GET'
        ? await board.remarks(db, course, user, id)
        : await board.comment(db, course, user, id, await jsonBody(request)));
      if (method === 'POST') return response(await board.change(db, course, user, id, action, await jsonBody(request)));
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
    if (parts.length === 4 && section === 'assignments' && method === 'GET') {
      return response(await learning.assignmentDetail(db, course, user, parts[3], Boolean(env.DOCUMENTS)));
    }
    if (section === 'assignments' && parts[4] === 'attachment') {
      if (parts.length === 5 && method === 'POST') return response(await files.attachSubmission(env, course, user, parts[3], request, url.searchParams.get('name')));
      if (parts.length === 6 && method === 'GET') return await files.downloadSubmission(env, course, user, parts[3], parts[5]);
    }
    if (parts.length === 5 && section === 'assignments') {
      const [, , , id, action] = parts;
      if (action === 'deliver' && method === 'POST') return response(await learning.deliver(db, course, user, id, await jsonBody(request)));
      if (action === 'reviews' && method === 'GET') return response(await learning.reviews(db, course, id));
      if (action === 'reviews' && method === 'POST') return response(await learning.grade(db, course, id, await jsonBody(request)));
    }
    if (section === 'lessons') {
      if (parts.length === 3 && method === 'GET') return response(await lessons.lessons(db, course));
      if (parts.length === 3 && method === 'POST') return response(await lessons.createLesson(env, course, request, url.searchParams));
      if (parts.length === 4 && method === 'GET') return await lessons.lessonFile(env, course, parts[3], request);
      if (parts.length === 4 && method === 'POST') return response(await lessons.scheduleLesson(db, course, parts[3], await jsonBody(request)));
    }
    if (section === 'exams' && parts.length === 5) {
      const [, , , id, action] = parts;
      if (method === 'GET' && action === 'attempts') return response(await exams.attempts(db, course, user, id));
      if (method === 'POST' && action === 'schedule') return response(await exams.scheduleExam(db, course, id, await jsonBody(request)));
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
        case 'posts': return response(await board.board(db, course, user));
        case 'topics': return response(await materials.sections(db, course, url));
        case 'materials': return response(await materials.resources(db, course, url));
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
        case 'board-settings': return response(await board.permissions(db, course, user, data));
        case 'posts': return response(await board.publish(db, course, user, data));
        case 'topics': return response(await materials.createTopic(db, course, data));
        case 'materials': return response(await materials.addResource(db, course, data));
        case 'exams': return response(await exams.createExam(db, course, data));
        case 'assignments': return response(await learning.addAssignment(db, course, data));
        case 'attendance': return response(await learning.markAttendance(db, course, data));
        case 'subject-color': return response(await classes.updateSubjectColor(db, course, user, data));
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

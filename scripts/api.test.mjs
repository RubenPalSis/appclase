import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { onRequest } from '../functions/api/[[path]].ts';
import { hash, now } from '../server/security.ts';
import { passwordRecord } from '../server/auth.ts';

const origin = 'https://appclase.example';
const migration = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(migration);
  sqlite.exec(await readFile(new URL("../migrations/0002_exams.sql", import.meta.url), "utf8"));
  sqlite.exec(await readFile(new URL('../migrations/0003_membership_status.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0004_documents.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0005_calendar.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0006_messages.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0007_notifications.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0008_board.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0009_topics.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0010_local_auth.sql', import.meta.url), 'utf8'));
  sqlite.exec(`
    INSERT INTO users VALUES ('teacher','t@example.com','Profe'),('student','s@example.com','Alumna'),
      ('outside','x@example.com','Externo'),('other','o@example.com','Otro alumno'),('admin','a@example.com','Admin');
    INSERT INTO organizations VALUES ('center','Centro'),('different','Otro centro');
    INSERT INTO memberships (org_id,user_id,role) VALUES ('center','teacher','teacher'),('center','student','student'),
      ('center','other','student'),('different','outside','teacher'),('center','admin','admin');
    INSERT INTO classes(id,org_id,teacher_id,name,subject,description,academic_year)
      VALUES ('course','center','teacher','Clase','Materia','','2026');
    INSERT INTO class_students VALUES ('course','student'),('course','other');
  `);
  sqlite.exec(await readFile(new URL('../migrations/0011_platform_access.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../migrations/0012_subject_colors.sql', import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO platform_administrators VALUES ('admin')");
  const sessions = new Map();
  for (const [index, user] of ['teacher','student','outside','other','admin'].entries()) {
    const value = String(index + 1).repeat(64);
    sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run(await hash(value), user, now() + 1000);
    sessions.set(user, value);
  }
  const objects = new Map();
  const env = {
    DOCUMENTS: {
      put: (key, value) => objects.set(key, value),
      get: key => objects.has(key) ? {body:objects.get(key)} : null,
      delete: key => objects.delete(key),
    },
    APP_ORIGIN: origin,
    DB: {
      prepare(sql) {
        return { bind(...values) {
          const stmt = sqlite.prepare(sql);
          return {
            first: () => stmt.get(...values) ?? null,
            all: () => ({ results: stmt.all(...values) }),
            run: () => ({ meta: stmt.run(...values) }),
          };
        } };
      },
      batch(commands) {
        sqlite.exec('BEGIN');
        try {
          const result = commands.map(command => command.run());
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  const call = async (path, user, payload, from = origin) => {
    const raw = payload instanceof Uint8Array;
    const headers = {};
    if (user) headers.Cookie = 'appclase_session=' + sessions.get(user);
    if (payload !== undefined) {
      headers.Origin = from;
      headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
    }
    const result = await onRequest({
      request: new Request(origin + '/api' + path, {
        method: payload === undefined ? 'GET' : 'POST',
        headers,
        body: payload === undefined ? undefined : raw ? payload : JSON.stringify(payload),
      }),
      env,
    });
    return { cookie: result.headers.get('set-cookie'), status: result.status, data: result.status === 204 ? null : result.headers.get('content-type')?.startsWith('text/') ? await result.text() : result.headers.has('content-disposition') ? new Uint8Array(await result.arrayBuffer()) : await result.json() };
  };
  call.sqlite = sqlite;
  return call;
}

test('autenticación, cierre de sesión y origen de escrituras', async t => {
  const call = await fixture(t);
  assert.equal((await call('/me')).status, 401);
  assert.equal((await call('/me','student')).data.user.name, 'Alumna');
  assert.equal((await call('/logout','student',{},'https://other.example')).status, 403);
  assert.equal((await call('/logout','student',{})).status, 204);
  assert.equal((await call('/me','student')).status, 401);
});

test('cambio de contraseña verifica la clave actual y conserva solo la sesión activa', async t => {
  const call = await fixture(t);
  const { salt, digest } = await passwordRecord('Clave anterior segura 123');
  call.sqlite.prepare('INSERT INTO password_credentials (user_id,salt,digest) VALUES (?,?,?)').run('teacher', salt, digest);
  assert.equal((await call('/auth/password','teacher',{current_password:'incorrecta',password:'Nueva clave muy segura 123'})).status, 401);
  assert.equal((await call('/auth/password','teacher',{current_password:'Clave anterior segura 123',password:'Clave anterior segura 123'})).status, 400);
  assert.equal((await call('/auth/password','teacher',{current_password:'Clave anterior segura 123',password:'Nueva clave muy segura 123'})).status, 200);
  assert.equal(call.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get('teacher').count, 1);
});

test('aislamiento entre centros y prohibición de cambios para alumnos', async t => {
  const call = await fixture(t);
  assert.deepEqual((await call('/classes','outside')).data, []);
  assert.equal((await call('/classes/course/posts','outside')).status, 404);
  assert.equal((await call('/classes/course/posts','student',{body:'Anuncio'})).status, 403);
  assert.equal((await call('/classes','student',{org_id:'center',role:'admin'})).status, 403);
  assert.equal((await call('/classes/course/posts','teacher',{body:'Anuncio'})).status, 200);
  assert.equal((await call('/classes/course/posts','student')).data[0].body, 'Anuncio');
  assert.equal((await call('/classes/course/materials','teacher',{title:'Prueba',url:'javascript:alert(1)'})).status, 400);
});

test('invitaciones, rotación y archivo', async t => {
  const call = await fixture(t);
  const old = (await call('/classes/course/invite','teacher',{})).data.code;
  const code = (await call('/classes/course/invite','teacher',{})).data.code;
  assert.notEqual(old, code);
  assert.equal((await call('/join','outside',{code:old})).status, 404);
  assert.equal((await call('/join','outside',{code,role:'admin'})).status, 200);
  assert.equal((await call('/join','outside',{code})).status, 200);
  assert.equal((await call('/classes/course','outside')).data.role, 'student');
  assert.equal((await call('/classes/course/archive','teacher',{archived:true})).status, 200);
  assert.equal((await call('/join','outside',{code})).status, 404);
  assert.equal((await call('/classes/course/posts','teacher',{body:'Cerrado'})).status, 409);
});

test('entregas, notas privadas y asistencia individual', async t => {
  const call = await fixture(t);
  const route = '/classes/course';
  assert.equal((await call(route+'/assignments','teacher',{
    title:'Ejercicio',body:'Describe el problema',due:now()+600,points:10,allow_late:false,
  })).status, 200);
  const [{id}] = (await call(route+'/assignments','student')).data;
  const endpoint = route+'/assignments/'+id;
  assert.equal((await call(endpoint+'/deliver','student',{body:'Respuesta privada'})).status, 200);
  assert.equal((await call(endpoint,'outside')).status, 404);
  assert.equal((await call(endpoint,'student')).data.task.answer, 'Respuesta privada');
  const otherDetail = (await call(endpoint,'other')).data;
  assert.equal(otherDetail.task.answer, null);
  assert.equal(otherDetail.roster, undefined);
  const {roster} = (await call(endpoint,'teacher')).data;
  assert.equal(roster.find(row => row.user_id === 'student').body, 'Respuesta privada');
  assert.equal(roster.find(row => row.user_id === 'other').submitted, null);
  assert.equal((await call(route+'/assignments','teacher')).data[0].pending_reviews, 1);
  assert.equal((await call(route+'/assignments','student')).data[0].pending_reviews, null);
  assert.equal((await call(endpoint+'/reviews','other')).status, 403);
  assert.equal((await call(endpoint+'/reviews','teacher',{user_id:'student',score:11,feedback:''})).status, 400);
  assert.equal((await call(endpoint+'/reviews','teacher',{user_id:'student',score:9,feedback:'Buen trabajo'})).status, 200);
  assert.equal((await call(endpoint+'/deliver','student',{body:'Cambios'})).status, 409);
  assert.equal((await call(route+'/assignments','student')).data[0].score, 9);
  assert.equal((await call(route+'/assignments','other')).data[0].answer, null);
  assert.equal((await call(route+'/attendance','teacher',{user_id:'student',day:'2026-02-30',notes:'',status:'late'})).status, 400);
  assert.equal((await call(route+'/attendance','teacher',{user_id:'student',day:'2026-02-28',notes:'Privado',status:'late'})).status, 200);
  assert.equal((await call(route+'/attendance','student')).data[0].notes, 'Privado');
  assert.deepEqual((await call(route+'/attendance','other')).data, []);
});

test('exámenes temporizados, intentos y respuestas correctas solo en el servidor', async t => {
  const call = await fixture(t);
  const route = '/classes/course/exams';
  const questions = [{prompt:'¿Cuánto es dos más dos?', options:['Tres','Cuatro'], correct:1}];
  const exam = {title:'Matemáticas', opens:now()-1, closes:now()+600, duration:60, max_attempts:1, questions};
  assert.equal((await call(route,'student',exam)).status, 403);
  assert.equal((await call(route,'teacher',exam)).status, 200);
  const [{id}] = (await call(route,'student')).data;
  const endpoint = route+'/'+id;
  const {data: attempt} = await call(endpoint+'/start','student',{});
  assert.equal(attempt.questions[0].correct, undefined);
  assert.equal((await call(endpoint+'/start','student',{})).data.id, attempt.id);
  assert.equal((await call(endpoint+'/'+attempt.id,'other',{answers:{0:1},submit:true})).status, 409);
  assert.equal((await call(endpoint+'/'+attempt.id,'student',{answers:{0:1},submit:false})).status, 200);
  assert.equal((await call(endpoint+'/start','student',{})).data.answers[0], 1);
  assert.equal((await call(endpoint+'/'+attempt.id,'student',{answers:{0:1},submit:true})).status, 200);
  assert.equal((await call(endpoint+'/start','student',{})).status, 409);
  assert.equal((await call(endpoint+'/attempts','student')).data[0].score, null);
  assert.equal((await call(endpoint+'/attempts','teacher')).data[0].score, 1);
});

test('gestión de usuarios, revocación sin reingreso y auditoría por centro', async t => {
  const call = await fixture(t);
  const endpoint = '/organizations/center/members';
  assert.equal((await call(endpoint,'teacher')).status, 404);
  assert.equal((await call('/organizations/different/members','admin')).status, 404);
  assert.equal((await call(endpoint,'admin',{user_id:'admin',role:'teacher',active:false})).status, 403);
  const {data: {code}} = await call('/classes/course/invite','teacher',{});
  assert.equal((await call(endpoint,'admin',{user_id:'student',role:'student',active:false})).status, 200);
  assert.equal((await call('/classes/course','student')).status, 404);
  assert.equal((await call('/join','student',{code})).status, 409);
  assert.ok((await call('/organizations/center/audit','admin')).data.some(item => item.action === 'membership.disabled'));
  assert.equal((await call(endpoint,'admin',{user_id:'student',role:'student',active:true})).status, 200);
  assert.equal((await call('/classes/course','student')).status, 200);
});

test('documentos privados, validación de formato y autorización de subida', async t => {
  const call = await fixture(t);
  const route = '/classes/course/documents';
  const pdf = new TextEncoder().encode('%PDF-1.7');
  assert.equal((await call(route+'?name=temario.pdf','student',pdf)).status, 403);
  assert.equal((await call(route+'?name=temario.pdf','teacher',new Uint8Array([0]))).status, 415);
  assert.equal((await call(route+'?name=temario.svg','teacher',pdf)).status, 415);
  const {data: {id}} = await call(route+'?name=temario.pdf','teacher',pdf);
  assert.equal((await call(route+'/'+id,'outside')).status, 404);
  assert.equal((await call(route,'student')).data[0].name, 'temario.pdf');
  assert.deepEqual((await call(route+'/'+id,'student')).data, pdf);
});

test('el color se comparte por asignatura y centro y solo el personal puede cambiarlo', async t => {
  const call = await fixture(t);
  const colorRoute = '/classes/course/subject-color';
  assert.equal((await call('/classes/course', 'student')).data.subject_color, null);
  assert.equal((await call(colorRoute, 'student', {subject_color:'#445566'})).status, 403);
  assert.equal((await call(colorRoute, 'outside', {subject_color:'#445566'})).status, 404);
  assert.equal((await call(colorRoute, 'teacher', {subject_color:'red'})).status, 400);

  const data = {name:'Otro grupo', subject:'materia', academic_year:'2026', subject_color:'#445566'};
  const second = await call('/classes', 'teacher', {...data, org_id:'center'});
  assert.equal(second.status, 200);
  assert.equal((await call('/classes/course', 'student')).data.subject_color, '#445566');

  const outside = await call('/classes', 'outside', {...data, org_id:'different', subject_color:'#112233'});
  assert.equal(outside.status, 200);
  assert.equal((await call(colorRoute, 'teacher', {subject_color:'#Aa2244'})).status, 200);
  const courses = (await call('/classes', 'teacher')).data;
  assert.deepEqual(courses.map(course => course.subject_color), ['#aa2244','#aa2244']);
  assert.equal((await call('/classes/' + outside.data.id, 'outside')).data.subject_color, '#112233');
});

test('calendario acotado, exportación ICS y protección contra saltos de línea', async t => {
  const call = await fixture(t);
  const route = '/classes/course/calendar';
  const time = now();
  const event = {title:'Tutoría, 1º\nEND:VEVENT',body:'Consulta',start:time+60,finish:time+120};
  assert.equal((await call(route,'student',event)).status, 403);
  assert.equal((await call(route,'teacher',event)).status, 200);
  const query = '?from='+time+'&until='+(time+180);
  assert.equal((await call(route+query,'outsider')).status, 401);
  assert.equal((await call(route+query,'outside')).status, 404);
  assert.equal((await call(route+query,'student')).data[0].title, event.title);
  const {data: ics} = await call(route+'/export'+query,'student');
  assert.ok(ics.includes('SUMMARY:Tutoría\\, 1º\\nEND:VEVENT'));
  assert.equal(ics.split('\r\n').filter(line => line === 'END:VEVENT').length,1);
});

test('calificaciones privadas y exportación CSV con campos neutralizados', async t => {
  const call = await fixture(t);
  const route = '/classes/course';
  await call(route+'/assignments','teacher',{title:'=1+1',body:'Texto',due:now()+60,points:10,allow_late:false});
  const [{id}] = (await call(route+'/assignments','student')).data;
  await call(route+'/assignments/'+id+'/deliver','student',{body:'Respuesta'});
  await call(route+'/assignments/'+id+'/reviews','teacher',{user_id:'student',score:6,feedback:'Revisado'});
  assert.equal((await call(route+'/grades','student')).data[0].score, 6);
  assert.deepEqual((await call(route+'/grades','other')).data, []);
  assert.equal((await call(route+'/grades/export','student')).status, 403);
  assert.ok((await call(route+'/grades/export','teacher')).data.includes("\"'=1+1\""));
});

test('conversaciones privadas, no leídos y moderación de mensajes reportados', async t => {
  const call = await fixture(t);
  const route = '/classes/course/messages';
  const endpoint = route+'/student';
  assert.equal((await call(endpoint,'other',{body:'Intrusión'})).status, 404);
  assert.equal((await call(endpoint,'admin')).status, 404);
  assert.equal((await call(endpoint,'teacher',{body:'Revisa el temario'})).status, 200);
  assert.equal((await call(route,'student')).data[0].unread, 1);
  const [{sequence}] = (await call(endpoint,'student')).data;
  assert.equal((await call(endpoint+'/read','student',{last_seen:sequence})).status, 200);
  assert.equal((await call(route,'student')).data[0].unread, 0);
  assert.deepEqual((await call('/organizations/center/reports','admin')).data, []);
  assert.equal((await call(endpoint+'/report','student',{id:sequence,reason:'Motivo de prueba'})).status, 200);
  assert.equal((await call('/organizations/center/reports','admin')).data[0].body, 'Revisa el temario');
  assert.equal((await call('/organizations/center/reports','teacher')).status, 404);
});

test('notificaciones privadas, leídas y filtrado por preferencias', async t => {
  const call = await fixture(t);
  await call('/classes/course/posts','teacher',{body:'Anuncio'});
  await call('/classes/course/messages/student','teacher',{body:'Mensaje'});
  assert.deepEqual((await call('/notifications','other')).data.map(n => n.category), ['announcement']);
  const notices = (await call('/notifications','student')).data;
  assert.deepEqual(notices.map(n => n.category), ['message','announcement']);
  assert.equal((await call('/notifications/read','other',{id:notices[0].id})).status, 404);
  assert.equal((await call('/notifications/read','student',{id:notices[0].id})).status, 200);
  assert.equal((await call('/notifications','student')).data[0].seen, 1);
  assert.equal((await call('/notifications/preferences','student',{category:'announcement',enabled:false})).status, 200);
  assert.equal((await call('/notifications','student')).data.length, 1);
  await call('/notifications/preferences','student',{category:'announcement',enabled:true});
  assert.equal((await call('/notifications','student')).data.length, 2);
});

test('tablón con permisos de alumnado, programación y moderación', async t => {
  const call = await fixture(t);
  const route = '/classes/course';
  await call(route+'/posts','teacher',{body:'Programado',publish_at:now()+120});
  assert.deepEqual((await call(route+'/posts','student')).data, []);
  assert.deepEqual((await call('/notifications','student')).data, []);
  assert.equal((await call(route+'/board-settings','teacher',{student_posts:true,student_comments:true})).status, 200);
  assert.equal((await call(route+'/posts','student',{body:'Participación'})).status, 200);
  assert.equal((await call(route+'/posts','student',{body:'Fijado',pinned:true})).status, 403);
  const [{id}] = (await call(route+'/posts','student')).data;
  assert.equal((await call(route+'/posts/'+id+'/comments','other',{body:'Respuesta'})).status, 200);
  assert.equal((await call(route+'/posts/'+id+'/pin','student',{})).status, 403);
  assert.equal((await call(route+'/posts/'+id+'/pin','teacher',{})).status, 200);
  assert.equal((await call(route+'/posts/'+id+'/edit','other',{body:'Intento'})).status, 403);
  assert.equal((await call(route+'/posts/'+id+'/delete','teacher',{})).status, 200);
  assert.equal((await call(route+'/posts/'+id+'/comments','other')).status, 404);
});

test('panel de próximas entregas respeta pertenencia y entregas realizadas', async t => {
  const call = await fixture(t);
  const route = '/classes/course/assignments';
  await call(route,'teacher',{title:'Práctica',body:'Texto',due:now()+60,points:10,allow_late:false});
  assert.deepEqual((await call('/dashboard/upcoming','outside')).data, []);
  const [{id}] = (await call('/dashboard/upcoming','student')).data;
  await call(route+'/'+id+'/deliver','student',{body:'Respuesta'});
  assert.deepEqual((await call('/dashboard/upcoming','student')).data, []);
  assert.equal((await call('/dashboard/upcoming','teacher')).data.length, 1);
});

test('temario jerárquico, búsqueda y permisos de escritura', async t => {
  const call = await fixture(t);
  const route = '/classes/course';
  assert.equal((await call(route+'/topics','student',{title:'Unidad',kind:'unit',sort_order:0})).status,403);
  assert.equal((await call(route+'/topics','teacher',{title:'Unidad',kind:'unit',sort_order:0})).status,200);
  const [{id}] = (await call(route+'/topics','student')).data;
  assert.equal((await call(route+'/topics','teacher',{title:'Tema',kind:'topic',topic_id:id,sort_order:0})).status,200);
  assert.equal((await call(route+'/topics?topic='+id,'student')).data[0].title,'Tema');
  assert.equal((await call(route+'/materials','teacher',{title:'Aragón',body:'Zaragoza %',topic_id:id})).status,200);
  assert.deepEqual((await call(route+'/materials','student')).data,[]);
  assert.equal((await call(route+'/materials?q=%25','student')).data[0].topic,'Unidad');
  assert.equal((await call(route+'/topics?topic='+id,'outside')).status,404);
});

test('registro propio, inicio de sesión y asociaciones de roles', async t => {
  const call = await fixture(t);
  const account = {name:'Cuenta local',email:'local@example.com',password:'contraseña de prueba',role:'admin'};
  assert.equal((await call('/auth/register',null,account)).status,204);
  assert.equal((await call('/auth/login',null,{...account,password:'incorrecta'})).status,401);
  const login = await call('/auth/login',null,account);
  assert.equal(login.status,204);
  assert.match(login.cookie,/HttpOnly/);
  const {id} = call.sqlite.prepare('SELECT id FROM users WHERE email=?').get(account.email);
  assert.equal(call.sqlite.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').get(id).n,0);
  assert.equal(call.sqlite.prepare('SELECT COUNT(*) AS n FROM administrators').get().n,1);
  const endpoint = '/organizations/center/members';
  assert.equal((await call(endpoint,'admin',{user_id:id,role:'teacher',active:true})).status,200);
  assert.equal(call.sqlite.prepare('SELECT active FROM teachers WHERE user_id=?').get(id).active,1);
  assert.equal((await call(endpoint,'admin',{user_id:id,role:'student',active:false})).status,200);
  assert.equal(call.sqlite.prepare('SELECT active FROM students WHERE user_id=?').get(id).active,0);
  assert.equal(call.sqlite.prepare('SELECT active FROM teachers WHERE user_id=?').get(id),undefined);
});

test('administración global y primer acceso docente con código del centro', async t => {
  const call = await fixture(t);
  assert.equal((await call('/organizations','teacher',{name:'Aula'})).status,403);
  const {data:center} = await call('/organizations','admin',{name:'Centro Nuevo'});
  assert.match(center.access_code,/^[A-Z2-9]{4}$/);
  const path = '/organizations/'+center.id+'/teachers';
  const account = {name:'Docente nuevo',email:'nuevo@example.com'};
  assert.equal((await call(path,'teacher',account)).status,404);
  const {data:invitation} = await call(path,'admin',account);
  assert.equal(invitation.access_code, center.access_code);
  const credentials = {email:account.email,password:invitation.password};
  assert.equal((await call('/auth/login',null,credentials)).status,401);
  assert.equal((await call('/auth/login',null,{...credentials,center_code:center.access_code})).status,204);
  const role = call.sqlite.prepare('SELECT role FROM memberships JOIN users ON users.id=memberships.user_id WHERE email=?').get(account.email);
  assert.equal(role.role,'teacher');
});

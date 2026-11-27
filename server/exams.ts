import { requireStaff } from './classes.ts';
import { HttpError, first, integer, list, now, run, text } from './security.ts';

export function examList(db, course, user) {
  return list(db, `SELECT e.id,e.title,e.opens,e.closes,e.duration,e.max_attempts,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.user_id=?) AS attempts
    FROM exams e WHERE e.class_id=? ORDER BY e.opens,e.id LIMIT 100`, user.id, course.id);
}

function validateQuestions(input) {
  if (!Array.isArray(input) || !input.length || input.length > 30) {
    throw new HttpError(400, 'Introduce entre 1 y 30 preguntas.');
  }
  return input.map(item => {
    if (!item || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8) {
      throw new HttpError(400, 'Cada pregunta debe tener entre 2 y 8 opciones.');
    }
    return {
      prompt: text(item.prompt, 600),
      options: item.options.map(option => text(option, 300)),
      correct: integer(item.correct, 0, item.options.length - 1),
    };
  });
}

export async function createExam(db, course, data) {
  requireStaff(course);
  const opens = integer(data.opens, now() - 300, 4102444800);
  const closes = integer(data.closes, opens + 60, 4102444800);
  const duration = integer(data.duration, 60, Math.min(closes - opens, 4 * 3600));
  await run(db, 'INSERT INTO exams VALUES (?,?,?,?,?,?,?,?)', crypto.randomUUID(), course.id,
    text(data.title, 160), opens, closes, duration, integer(data.max_attempts, 1, 10),
    JSON.stringify(validateQuestions(data.questions)));
  return {};
}

async function exam(db, course, id) {
  const value = await first(db, 'SELECT * FROM exams WHERE id=? AND class_id=?', id, course.id);
  if (!value) throw new HttpError(404, 'No se encuentra el examen.');
  return value;
}

function requireStudent(course) {
  if (course.role !== 'student' || course.archived) throw new HttpError(403, 'Tu acceso al examen está cerrado.');
}

function publicAttempt(attempt, value) {
  const timestamp = now();
  return {
    id: attempt.id, number: attempt.number, deadline: attempt.deadline, server_time: timestamp,
    submitted: attempt.submitted, closed: attempt.deadline < timestamp,
    answers: JSON.parse(attempt.answers),
    questions: JSON.parse(value.questions).map(({ prompt, options }) => ({ prompt, options })),
    score: timestamp > value.closes ? attempt.score : null,
  };
}

async function closeExpired(db, attempt, value) {
  if (!attempt || attempt.submitted !== null || now() <= attempt.deadline) return attempt;
  const questions = JSON.parse(value.questions);
  const answers = JSON.parse(attempt.answers);
  const score = questions.filter((question, index) => answers[index] === question.correct).length;
  // Match the snapshot used for grading so an earlier draft cannot overwrite a just-saved draft.
  await run(db, 'UPDATE exam_attempts SET submitted=?,score=? WHERE id=? AND submitted IS NULL AND answers=?',
    attempt.deadline, score, attempt.id, attempt.answers);
  return first(db, 'SELECT * FROM exam_attempts WHERE id=?', attempt.id);
}

export async function startExam(db, course, user, id) {
  requireStudent(course);
  const value = await exam(db, course, id);
  const timestamp = now();
  if (timestamp < value.opens || timestamp >= value.closes) throw new HttpError(409, 'El examen está fuera del plazo de apertura.');
  const latest = await closeExpired(db, await first(db, `SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=?
    ORDER BY number DESC LIMIT 1`, id, user.id), value);
  if (latest && latest.submitted === null) return publicAttempt(latest, value);
  if ((latest?.number ?? 0) >= value.max_attempts) throw new HttpError(409, 'Has agotado los intentos disponibles.');
  const number = (latest?.number ?? 0) + 1;
  await run(db, `INSERT INTO exam_attempts (id,exam_id,user_id,number,started,deadline)
    VALUES (?,?,?,?,?,?) ON CONFLICT(exam_id,user_id,number) DO NOTHING`,
  crypto.randomUUID(), id, user.id, number, timestamp, Math.min(value.closes, timestamp + value.duration));
  return publicAttempt(await first(db, 'SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=? AND number=?', id, user.id, number), value);
}

export async function attempts(db, course, user, id) {
  const value = await exam(db, course, id);
  if (course.role !== 'student') {
    return list(db, `SELECT a.number,u.name,a.started,a.deadline,a.submitted,a.score FROM exam_attempts a
      JOIN users u ON u.id=a.user_id WHERE a.exam_id=? ORDER BY a.started DESC LIMIT 100`, id);
  }
  const values = await list(db, 'SELECT * FROM exam_attempts WHERE exam_id=? AND user_id=? ORDER BY number DESC', id, user.id);
  return Promise.all(values.map(async attempt => publicAttempt(await closeExpired(db, attempt, value), value)));
}

export async function saveExam(db, course, user, examId, attemptId, data) {
  requireStudent(course);
  const value = await exam(db, course, examId);
  const questions = JSON.parse(value.questions);
  const answers = {};
  if (!data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers) || typeof data.submit !== 'boolean') {
    throw new HttpError(400, 'Las respuestas no son válidas.');
  }
  for (const [index, option] of Object.entries(data.answers)) {
    const question = /^\d+$/.test(index) ? questions[Number(index)] : null;
    if (!question || String(Number(index)) !== index) throw new HttpError(400, 'La pregunta no es válida.');
    answers[index] = integer(option, 0, question.options.length - 1);
  }
  const timestamp = now();
  const score = questions.filter((question, index) => answers[index] === question.correct).length;
  const result = await run(db, `UPDATE exam_attempts SET answers=?,submitted=?,score=?
    WHERE id=? AND exam_id=? AND user_id=? AND submitted IS NULL AND deadline>=?`,
  JSON.stringify(answers), data.submit ? timestamp : null, data.submit ? score : null, attemptId, examId, user.id, timestamp);
  if (!result.meta.changes) throw new HttpError(409, 'El intento ha finalizado o el plazo ha vencido.');
  return {};
}

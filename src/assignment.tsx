import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from './lib/api';

type Work = {
  submitted: number | null;
  score: number | null;
  feedback: string | null;
};

type Submission = Work & { user_id: string; name: string; body: string | null };
type Detail = {
  role: string;
  archived: number;
  task: Work & { title: string; body: string; due: number; points: number; allow_late: number; answer: string | null };
  roster?: Submission[];
};

export const assignmentLink = (classId: string, assignmentId: string) =>
  `/clases/${encodeURIComponent(classId)}/tareas/${encodeURIComponent(assignmentId)}`;

const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const status = (work: Work) =>
  work.score !== null ? 'Corregida' : work.submitted !== null ? 'Entregada' : 'Sin entregar';

export function AssignmentPage() {
  const { id = '', assignmentId = '' } = useParams();
  const endpoint = `/classes/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}`;
  return <AssignmentDetail key={endpoint} endpoint={endpoint} classId={id}/>;
}

function AssignmentDetail({ endpoint, classId }: { endpoint: string; classId: string }) {
  const [detail, setDetail] = useState<Detail>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => setDetail(await api.get<Detail>(endpoint)), [endpoint]);

  useEffect(() => {
    void load().catch(reason => setError((reason as Error).message));
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, submission?: Submission) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (submission) {
        await api.post(endpoint + '/reviews', {
          user_id: submission.user_id,
          score: Number(form.get('score')),
          feedback: form.get('feedback'),
        });
      } else {
        await api.post(endpoint + '/deliver', { body: form.get('answer') });
      }
      await load();
      setNotice(submission ? 'Corrección guardada.' : 'Entrega guardada.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const back = <Link className="back-link" to={`/clases/${classId}`}>Volver a la clase</Link>;
  if (!detail) return <div className="content-wrap">{back}
    {error ? <p className="error-box" role="alert">{error}</p> : <p role="status">Cargando tarea…</p>}
  </div>;

  const { task, roster = [] } = detail;
  const canDeliver = !detail.archived && task.score === null &&
    (task.allow_late || Math.floor(Date.now() / 1000) <= task.due);

  return <div className="content-wrap">{back}
    <section className="panel mb-4">
      <h1 className="mb-3">{task.title}</h1>
      <p className="whitespace-pre-wrap break-words">{task.body}</p>
      <p className="muted mt-3">Fecha límite · {dateTime.format(task.due * 1000)} · {task.points} puntos</p>
    </section>
    {error && <p role="alert" className="error-box mb-4">{error}</p>}
    {notice && <p role="status" className="inline-note">{notice}</p>}
    {detail.role === 'student' ? <section className="panel">
      <h2>Mi entrega · {status(task)}</h2>
      {task.score !== null && <p className="mt-3">Nota · {task.score}/{task.points}</p>}
      {task.feedback && <p className="mt-3 whitespace-pre-wrap break-words">{task.feedback}</p>}
      {canDeliver ? <form className="form-stack mt-4" onSubmit={event => void save(event)}>
        <label className="field"><span>Respuesta</span><textarea name="answer" rows={5} required maxLength={10000} defaultValue={task.answer ?? ''}/></label>
        <button className="button primary" disabled={busy}>{task.submitted ? 'Actualizar entrega' : 'Enviar tarea'}</button>
      </form> : task.answer && <p className="mt-4 whitespace-pre-wrap break-words">{task.answer}</p>}
      {!canDeliver && task.score === null && <p className="muted mt-3">Las entregas están cerradas.</p>}
    </section> : <section className="panel">
      <h2>Entregas del grupo</h2>
      <p className="muted mt-2">{roster.filter(work => work.submitted !== null && work.score === null).length} por corregir · {roster.filter(work => work.submitted === null).length} sin entregar</p>
      {!roster.length && <p className="muted mt-3">Todavía no hay alumnos en este grupo.</p>}
      {roster.map(work => <article className="mt-4 border-t border-line pt-4" key={work.user_id}>
        <h3>{work.name} · {status(work)}</h3>
        {work.body && <p className="mt-2 whitespace-pre-wrap break-words">{work.body}</p>}
        {work.submitted !== null && !detail.archived && <form className="form-stack mt-3" onSubmit={event => void save(event, work)}>
          <label className="field"><span>Nota sobre {task.points}</span><input className="ui-input" name="score" type="number" required min={0} max={task.points} defaultValue={work.score ?? ''}/></label>
          <label className="field"><span>Comentarios de la corrección</span><textarea name="feedback" rows={2} maxLength={4000} defaultValue={work.feedback ?? ''}/></label>
          <button className="button primary" disabled={busy}>Guardar corrección</button>
        </form>}
        {!!detail.archived && work.score !== null && <p className="mt-2 whitespace-pre-wrap break-words">{work.score}/{task.points} {work.feedback}</p>}
      </article>)}
    </section>}
  </div>;
}

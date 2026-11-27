import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LockedContent, ScheduleVisibility, scheduleValue } from './class-content';
import { api, type Row } from './lib/api';

const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const instant = (value: FormDataEntryValue | null) => Math.floor(new Date(String(value)).getTime() / 1000);
const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

export function ClassAttendance({ path, staff, archived }: { path: string; staff: boolean; archived: boolean }) {
  const [day, setDay] = useState(localDay);
  const [result, setResult] = useState<{ day: string; rows: Row[] }>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const statuses = { present: 'Presente', absent: 'Ausente', late: 'Retraso', excused: 'Justificada' };
  useEffect(() => {
    let active = true;
    setError('');
    setSaved('');
    api.get<Row[]>(path + '/attendance?day=' + day).then(
      rows => { if (active) setResult({ day, rows }); },
      reason => { if (active) setError((reason as Error).message); },
    );
    return () => { active = false; };
  }, [path, day]);
  async function save(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api.post(path + '/attendance', { user_id: userId, day, status: form.get('status'), notes: form.get('notes') });
      setSaved('Asistencia guardada.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const rows = result?.day === day ? result.rows : undefined;
  return <div className="grid gap-3">
    {staff && <label className="field"><span>Fecha de la lista</span><input className="ui-input" type="date" value={day} disabled={busy}
      onChange={event => { if (event.target.value) setDay(event.target.value); }}/></label>}
    {error && <p className="error-box" role="alert">{error}</p>}
    {saved && <p role="status">{saved}</p>}
    {!rows && !error && <p role="status">Cargando asistencia…</p>}
    {rows?.length === 0 && <p className="muted">Todavía no hay registros.</p>}
    {rows?.map(row => staff && !archived ? <form className="form-stack border-t border-line pt-3" key={day + row.id}
      onSubmit={event => void save(event, row.id)}>
      <h3>{row.name}</h3>
      <label className="field"><span>Estado</span><select className="ui-input" name="status" required defaultValue={row.status ?? ''}>
        <option value="" disabled>Selecciona un estado</option>
        {Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label className="field"><span>Observaciones</span><input className="ui-input" name="notes" defaultValue={row.notes ?? ''} maxLength={1000}/></label>
      <button className="button soft small-button" disabled={busy}>Guardar asistencia</button>
    </form> : <div key={row.id ?? row.day}>
      <strong>{row.name ?? row.day}</strong> · {statuses[row.status as keyof typeof statuses] ?? 'Sin registrar'}
      {row.notes && <p className="muted">{row.notes}</p>}
    </div>)}
  </div>;
}

export function ClassExams({ path, staff, archived, initialId }: { path: string; staff: boolean; archived: boolean; initialId?: string }) {
  const [exams, setExams] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState(initialId);
  const [scheduling, setScheduling] = useState(false);
  const [attempts, setAttempts] = useState<Row[]>([]);
  const [attempt, setAttempt] = useState<Row>();
  const [questions, setQuestions] = useState(1);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const load = useCallback(async () => {
    setExams(await api.get<Row[]>(path + '/exams'));
    setClock(Date.now());
  }, [path]);
  useEffect(() => {
    void load().catch(reason => setError((reason as Error).message));
    const timer = window.setInterval(() => { if (!document.hidden) void load().catch(() => {}); }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!attempt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [attempt]);
  const selected = exams.find(exam => exam.id === selectedId);
  const locked = Boolean(selected?.locked) && !staff;
  const examPath = selected ? path + '/exams/' + selected.id : '';
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(async () => {
      await api.post(path + '/exams', {
        title: form.get('title'), opens: instant(form.get('opens')), closes: instant(form.get('closes')),
        hidden_until_open: form.get('visibility') === 'hidden',
        duration: Number(form.get('minutes')) * 60, max_attempts: Number(form.get('attempts')),
        questions: Array.from({ length: questions }, (_, index) => ({
          prompt: form.get('question-' + index),
          options: [form.get('a-' + index), form.get('b-' + index), form.get('c-' + index), form.get('d-' + index)].filter(Boolean),
          correct: Number(form.get('correct-' + index)),
        })),
      });
      setCreating(false);
      await load();
      setNotice('Examen publicado.');
    });
  }
  const timeLeft = attempt ? Math.max(0, Math.floor((attempt.localDeadline - clock) / 1000)) : 0;
  return <div className="grid gap-4">
    {error && <p className="error-box" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {staff && !archived && <button className="button soft" disabled={busy} onClick={() => setCreating(!creating)}>{creating ? 'Cerrar formulario' : 'Crear examen'}</button>}
    {creating && <form className="form-stack" onSubmit={publish}>
      <label className="field"><span>Título</span><input className="ui-input" name="title" required maxLength={160}/></label>
      <label className="field"><span>Apertura</span><input className="ui-input" name="opens" type="datetime-local" required/></label>
      <label className="field"><span>Cierre</span><input className="ui-input" name="closes" type="datetime-local" required/></label>
      <label className="field"><span>Duración en minutos</span><input className="ui-input" name="minutes" type="number" min={1} max={240} defaultValue={30} required/></label>
      <label className="field"><span>Intentos permitidos</span><input className="ui-input" name="attempts" type="number" min={1} max={10} defaultValue={1} required/></label>
      <ScheduleVisibility/>
      {Array.from({ length: questions }, (_, index) => <fieldset className="form-stack border-t border-line pt-3" key={index}>
        <legend>Pregunta {index + 1}</legend>
        <label className="field"><span>Enunciado</span><input className="ui-input" name={'question-' + index} required maxLength={600}/></label>
        {['a', 'b', 'c', 'd'].map(option => <label className="field" key={option}><span>Opción {option.toUpperCase()}</span><input className="ui-input" name={option + '-' + index} required maxLength={300}/></label>)}
        <label className="field"><span>Respuesta correcta</span><select className="ui-input" name={'correct-' + index}>{['A','B','C','D'].map((value, i) => <option key={value} value={i}>{value}</option>)}</select></label>
      </fieldset>)}
      <div className="flex flex-wrap gap-2">
        <button className="button soft" type="button" disabled={questions === 30 || busy} onClick={() => setQuestions(questions + 1)}>Añadir pregunta</button>
        <button className="button soft" type="button" disabled={questions === 1 || busy} onClick={() => setQuestions(questions - 1)}>Quitar última pregunta</button>
        <button className="button primary" disabled={busy}>Publicar examen</button>
      </div>
    </form>}
    {!exams.length && <p className="muted">Todavía no hay exámenes publicados.</p>}
    {exams.map(exam => <button className="button soft" key={exam.id} disabled={busy} onClick={() => void act(async () => {
      setSelectedId(exam.id);
      setScheduling(false);
      setAttempt(undefined);
      setAttempts([]);
      if (staff || !exam.locked) setAttempts(await api.get<Row[]>(path + '/exams/' + exam.id + '/attempts'));
    })}>{exam.locked ? '🔒 ' : ''}{exam.title} · {dateTime.format(exam.opens * 1000)}</button>)}
    {selected && <section className="grid gap-3">
      <h3>{selected.title}</h3>
      {selected.locked ? <LockedContent opens={selected.opens}/> : null}
      {staff && selected.hidden_until_open === 1 && <p className="muted">Oculto para el alumnado hasta la apertura.</p>}
      {staff && !archived && <button className="button soft" disabled={busy} onClick={() => setScheduling(!scheduling)}>
        {scheduling ? 'Cancelar edición' : 'Cambiar horario y visibilidad'}
      </button>}
      {scheduling && <form className="form-stack" key={selected.id} onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void act(async () => {
          await api.post(examPath + '/schedule', {
            opens: instant(form.get('opens')), closes: instant(form.get('closes')), hidden_until_open: form.get('visibility') === 'hidden',
          });
          setScheduling(false);
          await load();
          setNotice('Horario actualizado.');
        });
      }}>
        <label className="field"><span>Apertura</span><input className="ui-input" name="opens" type="datetime-local" required defaultValue={scheduleValue(selected.opens)}/></label>
        <label className="field"><span>Cierre</span><input className="ui-input" name="closes" type="datetime-local" required defaultValue={scheduleValue(selected.closes)}/></label>
        <ScheduleVisibility hidden={Boolean(selected.hidden_until_open)}/>
        <button className="button primary" disabled={busy}>Guardar horario</button>
      </form>}
      <p className="muted">Cierra el {dateTime.format(selected.closes * 1000)} · {selected.max_attempts} intentos permitidos</p>
      {!locked && !attempt && <button className="button soft small-button" disabled={busy}
        onClick={() => void act(async () => setAttempts(await api.get<Row[]>(examPath + '/attempts')))}>Actualizar intentos</button>}
      {attempts.map((row, i) => <p key={row.id ?? i}>{row.name ? row.name + ' · ' : ''}Intento {row.number} · {row.submitted != null ? 'Finalizado' : 'En curso'}{row.score != null ? ' · Aciertos ' + row.score : ''}</p>)}
      {!staff && !archived && !locked && !attempt && clock / 1000 < selected.closes && <button className="button primary" disabled={busy} onClick={() => void act(async () => {
        const next = await api.post<Row>(examPath + '/start');
        const localNow = Date.now();
        setClock(localNow);
        setAttempt({ ...next, localDeadline: localNow + (next.deadline - next.server_time) * 1000 });
        setAnswers(next.answers);
      })}>Empezar o continuar examen</button>}
      {attempt && <form className="form-stack" onSubmit={event => event.preventDefault()}>
        <p>Tiempo restante · {Math.floor(timeLeft / 60)} min {timeLeft % 60} s</p>
        {attempt.questions.map((question: Row, index: number) => <fieldset className="grid gap-2" key={index} disabled={busy || !timeLeft}>
          <legend>{question.prompt}</legend>
          {question.options.map((option: string, choice: number) => <label className="flex items-center gap-2" key={choice}>
            <input type="radio" name={'answer-' + index} checked={answers[index] === choice} onChange={() => setAnswers({ ...answers, [index]: choice })}/>{option}
          </label>)}
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
          {[false,true].map(submit => <button type="button" key={String(submit)} className={'button ' + (submit ? 'primary' : 'soft')}
            disabled={busy || !timeLeft} onClick={() => void act(async () => {
              await api.post(examPath + '/' + attempt.id, { answers, submit });
              if (submit) {
                setAttempt(undefined);
                setAttempts(await api.get<Row[]>(examPath + '/attempts'));
              }
              setNotice(submit ? 'Examen entregado.' : 'Borrador guardado.');
            })}>{submit ? 'Entregar examen' : 'Guardar borrador'}</button>)}
        </div>
      </form>}
      {attempt && !timeLeft && <button className="button soft" disabled={busy} onClick={() => void act(async () => {
        setAttempts(await api.get<Row[]>(examPath + '/attempts'));
        setAttempt(undefined);
      })}>Actualizar estado del intento</button>}
    </section>}
  </div>;
}

export function ClassDocuments({ path, canUpload }: { path: string; canUpload: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setRows(await api.get<Row[]>(path + '/documents')), [path]);
  useEffect(() => { void reload().catch(reason => setError((reason as Error).message)); }, [reload]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('document');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 16 * 1024 * 1024) throw Error('El documento supera los 16 MB.');
      const response = await fetch('/api' + path + '/documents?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      if (!response.ok) throw Error((await response.json()).error);
      form.reset();
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <h3>Documentos privados</h3>
    {error && <p className="error-box" role="alert">{error}</p>}
    {canUpload && <form className="form-stack" onSubmit={event => void upload(event)}>
      <label className="field"><span>Documento de clase · hasta 16 MB</span><input name="document" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx" required/></label>
      <button className="button primary" disabled={busy}>Subir documento</button>
    </form>}
    {!rows.length && <p className="muted">Todavía no hay documentos.</p>}
    {rows.map(file => <a key={file.id} className="button soft" href={'/api' + path + '/documents/' + file.id} download>{file.name}</a>)}
  </div>;
}

export function ClassRosterImport({ path, onImported }: { path: string; onImported: () => Promise<void> }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('csv');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      if (file.size > 32768) throw Error('El CSV supera los 32 KB.');
      const emails = (await file.text()).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
        .map(line => line.trim().replace(/^"([^"]*)"$/, '$1').trim()).filter(Boolean);
      if (['correo', 'email'].includes(emails[0]?.toLowerCase())) emails.shift();
      const result = await api.post<{ processed: number; unavailable: string[] }>(path + '/students/import', { emails });
      setStatus(`${result.processed - result.unavailable.length} inscritos o ya presentes.` +
        (result.unavailable.length ? ' Sin matrícula activa en este centro: ' + result.unavailable.join(', ') : ''));
      form.reset();
      await onImported();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="form-stack mb-4" onSubmit={event => void importCsv(event)}>
    <label className="field"><span>Importar lista de alumnos</span><input name="csv" type="file" accept=".csv,text/csv" required/></label>
    <p className="muted">CSV con una columna de correo, hasta 50 alumnos con matrícula activa en el centro.</p>
    <button className="button soft" disabled={busy}>Importar CSV</button>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="error-box">{error}</p>}
  </form>;
}

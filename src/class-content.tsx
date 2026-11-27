import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Lock, Video, FileText } from 'lucide-react';
import { api, type Row } from './lib/api';

export const scheduledDate = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' });
export const scheduleValue = (value: number) => {
  const date = new Date(value * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const scheduleSeconds = (value: FormDataEntryValue | null) => Math.floor(new Date(String(value)).getTime() / 1000);

export function ScheduleVisibility({ hidden = false }: { hidden?: boolean }) {
  return <label className="field">
    <span>Visibilidad antes de la apertura</span>
    <select className="ui-input" name="visibility" defaultValue={hidden ? 'hidden' : 'locked'}>
      <option value="locked">Visible en Agenda y en la clase, con candado</option>
      <option value="hidden">Oculto hasta la apertura</option>
    </select>
  </label>;
}

export function LockedContent({ opens }: { opens: number }) {
  return <p className="inline-note flex items-center gap-2" role="status"><Lock size={15} aria-hidden="true"/> Se abre el {scheduledDate.format(opens * 1000)}.</p>;
}

export function ScheduledLessons({ path, writable, staff, storage, initialId }: {
  path: string; writable: boolean; staff: boolean; storage: boolean; initialId?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState(initialId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => setRows(await api.get<Row[]>(path + '/lessons')), [path]);
  useEffect(() => {
    void reload().catch(reason => setError((reason as Error).message));
    const timer = window.setInterval(() => { if (!document.hidden) void reload().catch(() => {}); }, 15000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const selected = rows.find(row => row.id === selectedId);
  const locked = Boolean(selected?.locked) && !staff;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const opens = scheduleSeconds(form.get('opens'));
      const hidden = form.get('visibility') === 'hidden';
      if (editing && selected) {
        await api.post(path + '/lessons/' + selected.id, { opens, hidden_until_open: hidden });
        setEditing(false);
      } else {
        const file = form.get('file');
        if (!(file instanceof File) || !file.size) throw Error('Selecciona un archivo.');
        const limit = /\.pdf$/i.test(file.name) ? 16 : 48;
        if (file.size > limit * 1024 * 1024) throw Error('El archivo supera los ' + limit + ' MB.');
        const params = new URLSearchParams({
          name: file.name, title: String(form.get('title')), description: String(form.get('description')),
          opens: String(opens), hidden: hidden ? '1' : '0',
        });
        const response = await fetch('/api' + path + '/lessons?' + params, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
        });
        if (!response.ok) throw Error((await response.json()).error || 'No se pudo subir el archivo.');
        const uploaded = await response.json();
        setSelectedId(uploaded.id);
        setCreating(false);
      }
      await reload();
      setNotice(editing ? 'Horario actualizado.' : 'Contenido publicado.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-3">
    {writable && storage && <button className="button primary" disabled={busy} onClick={() => { setEditing(false); setCreating(!creating); }}>{creating ? 'Cancelar publicación' : 'Subir videoclase o PDF'}</button>}
    {writable && !storage && <p className="inline-note">El almacenamiento privado aún no está habilitado.</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {(creating || editing && selected) && <form className="form-stack" key={editing ? selected?.id : 'new'} onSubmit={event => void save(event)}>
      {!editing && <>
        <label className="field"><span>Título</span><input className="ui-input" name="title" maxLength={160} required/></label>
        <label className="field"><span>Descripción</span><textarea name="description" rows={3} maxLength={1000}/></label>
        <label className="field"><span>PDF hasta 16 MB. MP4 o WebM hasta 48 MB</span><input type="file" name="file" accept=".pdf,.mp4,.webm" required/></label>
      </>}
      <label className="field"><span>Fecha y hora de apertura</span><input className="ui-input" type="datetime-local" name="opens"
        defaultValue={scheduleValue(editing ? selected?.opens : Date.now() / 1000)} required/></label>
      <ScheduleVisibility hidden={editing && Boolean(selected?.hidden_until_open)}/>
      <button className="button primary" disabled={busy}>{editing ? 'Guardar horario' : 'Publicar contenido'}</button>
    </form>}
    {!rows.length && <p className="muted">Todavía no hay videoclases o PDF disponibles.</p>}
    {rows.map(row => <button className="button soft !justify-start" type="button" key={row.id} aria-pressed={selectedId === row.id}
      disabled={busy} onClick={() => { setSelectedId(row.id); setEditing(false); }}>
      {row.locked ? <Lock size={16}/> : row.mime?.startsWith('video/') ? <Video size={16}/> : <FileText size={16}/>}
      <span>{row.title} · {scheduledDate.format(row.opens * 1000)}</span>
    </button>)}
    {selected && <section className="grid gap-3 border-t border-line pt-4">
      <h3>{selected.title}</h3>
      {selected.locked ? <LockedContent opens={selected.opens}/> : null}
      {staff && selected.hidden_until_open === 1 && <p className="muted">Oculto para el alumnado hasta la apertura.</p>}
      {writable && <button className="button soft small-button" onClick={() => { setCreating(false); setEditing(!editing); }} disabled={busy}>{editing ? 'Cancelar edición' : 'Cambiar horario y visibilidad'}</button>}
      {!locked && <>
        {!!selected.description && <p className="whitespace-pre-wrap break-words">{selected.description}</p>}
        {selected.mime?.startsWith('video/')
          ? <video className="w-full rounded-lg bg-black" src={'/api' + path + '/lessons/' + selected.id} controls preload="metadata" playsInline aria-label={selected.title}/>
          : <a className="button soft" href={'/api' + path + '/lessons/' + selected.id} download>Descargar PDF</a>}
      </>}
    </section>}
  </div>;
}

type ChatThread = { student_id: string; name: string; unread: number };
type Message = { sequence: number; body: string; created: number; mine: number };

export function ClassChat({ path, archived, staff }: { path: string; archived: boolean; staff: boolean }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [peer, setPeer] = useState('');
  const [conversation, setConversation] = useState<{ peer: string; messages: Message[] }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = peer || (!staff ? threads[0]?.student_id : '');
  const endpoint = selected ? path + '/messages/' + selected : '';
  const visible = conversation?.peer === selected ? conversation?.messages : undefined;
  const reloadThreads = useCallback(async () => setThreads(await api.get<ChatThread[]>(path + '/messages')), [path]);

  useEffect(() => {
    void reloadThreads().catch(reason => setError((reason as Error).message));
    const timer = window.setInterval(() => { if (!document.hidden) void reloadThreads().catch(() => {}); }, 15000);
    return () => window.clearInterval(timer);
  }, [reloadThreads]);

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    let seen = 0;
    async function load() {
      try {
        const messages = await api.get<Message[]>(endpoint);
        if (!active) return;
        setConversation({ peer: selected, messages });
        const last = messages.at(-1)?.sequence ?? 0;
        if (last > seen) {
          await api.post(endpoint + '/read', { last_seen: last });
          seen = last;
          if (active) await reloadThreads();
        }
      } catch (reason) { if (active) setError((reason as Error).message); }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [endpoint, selected, reloadThreads]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body || !endpoint || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(endpoint, { body });
      form.reset();
      setConversation({ peer: selected, messages: await api.get<Message[]>(endpoint) });
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-3">
    {error && <p className="error-box" role="alert">{error}</p>}
    {!threads.length && <p className="muted">Todavía no hay conversaciones disponibles.</p>}
    {staff && threads.length > 0 && <label className="field"><span>Alumno</span><select className="ui-input" value={peer} disabled={busy}
      onChange={event => { setPeer(event.target.value); setError(''); }}>
      <option value="">Selecciona una conversación</option>
      {threads.map(thread => <option value={thread.student_id} key={thread.student_id}>{thread.name}{thread.unread ? ' · ' + thread.unread + ' sin leer' : ''}</option>)}
    </select></label>}
    {endpoint && <section className="grid gap-3">
      <h3>{threads.find(thread => thread.student_id === selected)?.name}</h3>
      <ol className="grid gap-2" aria-label="Mensajes de la conversación">
        {visible?.map(message => <li className={'rounded-lg border border-line p-3 ' + (message.mine ? 'ml-8' : 'mr-8')} key={message.sequence}>
          <strong>{message.mine ? 'Tú' : staff ? 'Alumno' : 'Profesor'}</strong>
          <time className="ml-2 muted" dateTime={new Date(message.created * 1000).toISOString()}>{scheduledDate.format(message.created * 1000)}</time>
          <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
        </li>)}
      </ol>
      {visible?.length === 0 && <p className="muted">Aún no hay mensajes.</p>}
      {!archived && <form className="form-stack" key={selected} onSubmit={event => void send(event)}>
        <label className="field"><span>Mensaje privado</span><textarea name="body" maxLength={2000} rows={3} required/></label>
        <button className="button primary" disabled={busy}>Enviar mensaje</button>
      </form>}
    </section>}
  </div>;
}

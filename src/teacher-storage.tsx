import { useEffect, useState, type FormEvent } from 'react';
import { api } from './lib/api';

type Profile = {
  available: boolean;
  connection: { origin:string; bucket:string } | null;
};

export function TeacherStorage() {
  const [profile,setProfile] = useState<Profile>();
  const [editing,setEditing] = useState(false);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  useEffect(() => {
    let active = true;
    void api.get<Profile>('/account/storage').then(
      data => { if (active) setProfile(data); },
      reason => { if (active) setError((reason as Error).message); },
    );
    return () => { active = false; };
  }, []);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = Object.fromEntries(new FormData(form));
      setProfile(await api.post<Profile>('/account/storage', data));
      form.reset();
      setEditing(false);
      setNotice('Supabase conectado. Las nuevas subidas se guardarán en tu bucket.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel mt-4">
    <h2>Almacenamiento de mis clases</h2>
    {error && <p className="error-box mt-3" role="alert">{error}</p>}
    {notice && <p className="inline-note mt-3" role="status">{notice}</p>}
    {!profile && !error && <p role="status">Cargando almacenamiento…</p>}
    {profile && !profile.available && <p className="muted mt-3">Las conexiones personales aún no están habilitadas.</p>}
    {profile?.available && <>
      <p className="muted mt-3">{profile.connection
        ? `${profile.connection.origin} · ${profile.connection.bucket}`
        : 'Conecta un proyecto de Supabase que hayas creado con tu propia cuenta.'}</p>
      <button className="button soft mt-3" type="button" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>
        {editing ? 'Cancelar' : profile.connection ? 'Cambiar conexión' : 'Conectar mi Supabase'}
      </button>
      {editing && <form className="form-stack mt-4" onSubmit={event => void connect(event)}>
        <p className="muted">Crea un bucket privado y una cuenta técnica dedicada. Los archivos anteriores seguirán en su proyecto de origen.</p>
        <a className="text-link" href="https://github.com/RubenPalSis/appclase#almacenamiento-personal-del-profesor">Guía de configuración del bucket</a>
        <label className="field"><span>URL del proyecto</span><input className="ui-input" name="origin" type="url" placeholder="https://tu-proyecto.supabase.co" defaultValue={profile.connection?.origin} required maxLength={100}/></label>
        <label className="field"><span>Bucket privado</span><input className="ui-input" name="bucket" defaultValue={profile.connection?.bucket ?? 'appclase-documentos'} required maxLength={63}/></label>
        <label className="field"><span>Clave publicable</span><input className="ui-input" name="api_key" placeholder="sb_publishable_…" maxLength={300} required/></label>
        <label className="field"><span>Correo de la cuenta técnica de Supabase</span><input className="ui-input" name="email" type="email" maxLength={254} autoComplete="off" required/></label>
        <label className="field"><span>Contraseña de la cuenta técnica de Supabase</span><input className="ui-input" name="password" type="password" minLength={12} maxLength={256} autoComplete="new-password" required/></label>
        <button className="button primary" disabled={busy}>{busy ? 'Comprobando…' : 'Probar y guardar'}</button>
      </form>}
    </>}
  </section>;
}

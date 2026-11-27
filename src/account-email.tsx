import { useEffect, useState, type FormEvent } from 'react';
import { api } from './lib/api';

export function useEmailEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { void api.get<{ email: boolean }>('/auth/options').then(config => setEnabled(config.email)).catch(() => {}); }, []);
  return enabled;
}

export function ResetRequest() {
  const enabled = useEmailEnabled();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!enabled) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post('/auth/reset-request', { email: data.get('email') });
      setMessage('Si la cuenta admite recuperación, recibirás un enlace en ese correo.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    <button className="button soft small-button" aria-expanded={open} onClick={() => setOpen(!open)}>Olvidé mi contraseña</button>
    {open && <form className="form-stack mt-3" onSubmit={event => void submit(event)}>
      <label className="field"><span>Correo de la cuenta</span><input className="ui-input" type="email" name="email" autoComplete="email" required/></label>
      <button className="button primary" disabled={busy}>Enviar enlace de recuperación</button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="error-box">{error}</p>}
    </form>}
  </div>;
}

export function PasswordResetPage({ token, onClose }: { token: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, password: data.get('password') });
      setDone(true);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="activate-page"><section className="auth-card">
    <h1>Restablecer contraseña</h1>
    {done ? <p role="status">Contraseña actualizada. Vuelve a iniciar sesión.</p>
      : <form className="form-stack" onSubmit={event => void submit(event)}>
          <label className="field"><span>Nueva contraseña</span><input className="ui-input" type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
          <label className="field"><span>Repite la contraseña</span><input className="ui-input" type="password" name="confirm" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
        <button className="button primary" disabled={busy}>Guardar contraseña</button>
        {error && <p role="alert" className="error-box">{error}</p>}
      </form>}
    <button className="button soft mt-3" onClick={onClose}>Volver a APPCLASE</button>
  </section></main>;
}

export type Row = Record<string, any>;
export type Session = { user: Row; organizations: Row[]; platform_admin?: boolean };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response.status, typeof result === 'object' ? result.error || 'No se pudo completar la operación.' : 'No se pudo completar la operación.');
  return result as T;
}

export const api = {
  get: <T = Row>(path: string) => request<T>(path),
  post: <T = Row>(path: string, body: unknown = {}) => request<T>(path, body),
  login: (email: string, password: string, center_code?: string) => request<void>('/auth/login', { email, password, center_code }),
  register: (name: string, email: string, password: string) => request<void>('/auth/register', { name, email, password }),
};

export function roleName(role?: string) { return ({ admin: 'Administrador', teacher: 'Profesor', student: 'Alumno' } as Record<string, string>)[role || ''] || 'Cuenta'; }
export function initials(name?: string) { return (name || 'A').trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase(); }
export function dateLabel(value?: string | number) { if (!value) return 'Sin fecha'; const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value); return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(date); }

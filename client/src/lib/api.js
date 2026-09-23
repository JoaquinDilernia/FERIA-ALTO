import { getSession, clearSession, roleForRoute } from './session.js';

export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function apiFetch(path, options = {}) {
  // Cada pantalla manda el token de su propio panel (ver session.js). El
  // panel se fija al empezar: si se cambia de pestaña mientras tanto, un 401
  // no puede borrar la sesión del otro panel.
  const role = roleForRoute();
  const token = getSession(role)?.token;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  // Sesión vencida (el token dura 12h y la feria dura varios días): limpiamos
  // la sesión muerta y volvemos al login en vez de dejar el panel inservible.
  // Ojo: las rutas de login también devuelven 401 cuando el PIN o la
  // contraseña están mal — ahí NO hay que recargar, porque se perdería el
  // mensaje de error en pantalla. Por eso exigimos que hubiera un token.
  if (res.status === 401 && token && !path.startsWith('/api/feria/auth/')) {
    clearSession(role);
    window.location.reload();
  }

  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

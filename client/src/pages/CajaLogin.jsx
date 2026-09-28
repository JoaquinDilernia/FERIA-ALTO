import { saveSession } from '../lib/session.js';
import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api.js';
import { LoginShell, Notice } from '../components/ui.jsx';

// Mismo ingreso para Caja y Logística (rol 'caja'); `panel` solo cambia el
// título para que cada uno sepa dónde está entrando.
export default function CajaLogin({ panel = 'caja' }) {
  const [users, setUsers] = useState(null);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/feria/auth/users')
      .then(({ admins }) => setUsers(admins))
      .catch(err => setError(`No se pudo cargar la lista de usuarios: ${err.message}`));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // El backend identifica al usuario por su id (email o nombre.apellido).
      const { token, user } = await apiFetch('/api/feria/auth/caja', {
        method: 'POST', body: JSON.stringify({ email: userId, password }),
      });
      saveSession('caja', token, user);
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginShell title={`${panel}.`} hint="Elegí tu usuario e ingresá tu contraseña." onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="user">Usuario</label>
        <select id="user" className="select" value={userId} disabled={!users}
          onChange={(e) => setUserId(e.target.value)} autoFocus>
          <option value="">{users ? 'Elegí tu nombre' : 'Cargando…'}</option>
          {users?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="password">Contraseña</label>
        <input id="password" className="input" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Notice kind="error">{error}</Notice>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={loading || !userId || !password}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
    </LoginShell>
  );
}

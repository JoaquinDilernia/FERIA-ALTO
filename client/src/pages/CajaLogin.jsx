import { saveSession } from '../lib/session.js';
import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { LoginShell, Notice } from '../components/ui.jsx';

// Mismo ingreso para Caja y Logística (rol 'caja'); `panel` solo cambia el
// título para que cada uno sepa dónde está entrando.
export default function CajaLogin({ panel = 'caja' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await apiFetch('/api/feria/auth/caja', {
        method: 'POST', body: JSON.stringify({ email, password }),
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
    <LoginShell title={`${panel}.`} hint="Ingresá con tu usuario de caja." onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="password">Contraseña</label>
        <input id="password" className="input" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Notice kind="error">{error}</Notice>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={loading || !email || !password}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
    </LoginShell>
  );
}

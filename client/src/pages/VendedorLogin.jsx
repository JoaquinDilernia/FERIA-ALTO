import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { LoginShell, Notice, uiStyles } from '../components/ui.jsx';

export default function VendedorLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, seller } = await apiFetch('/api/feria/auth/vendedor', {
        method: 'POST', body: JSON.stringify({ pin }),
      });
      localStorage.setItem('feria_token', token);
      localStorage.setItem('feria_role', 'vendedor');
      localStorage.setItem('feria_seller', JSON.stringify(seller));
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginShell title="vendedor." hint="Ingresá tu PIN para cargar pedidos." onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="pin">PIN</label>
      <input
        id="pin"
        className={`input ${uiStyles.pinInput}`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        autoFocus
      />
      <Notice kind="error">{error}</Notice>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={loading || !pin}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
    </LoginShell>
  );
}

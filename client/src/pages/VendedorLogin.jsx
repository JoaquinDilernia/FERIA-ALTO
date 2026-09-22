import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorLogin.module.css';

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
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <img src="/src/assets/ALTORANCHO.png" alt="Alto Rancho" className={styles.logo} />
        <h1 className={styles.title}>Feria — Vendedor</h1>
        <input
          className={styles.input}
          type="password"
          inputMode="numeric"
          placeholder="Tu PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.btn} type="submit" disabled={loading || !pin}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

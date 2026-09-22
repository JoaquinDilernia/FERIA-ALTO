import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './CajaLogin.module.css';
import logo from '../assets/ALTORANCHO.png';

export default function CajaLogin() {
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
      localStorage.setItem('feria_token', token);
      localStorage.setItem('feria_role', 'caja');
      localStorage.setItem('feria_user', JSON.stringify(user));
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
        <img src={logo} alt="Alto Rancho" className={styles.logo} />
        <h1 className={styles.title}>Feria — Caja</h1>
        <input
          className={styles.input} type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
        />
        <input
          className={styles.input} type="password" placeholder="Contraseña"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.btn} type="submit" disabled={loading || !email || !password}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatTime } from '../lib/feriaLabels.js';
import { Notice, EmptyState, ProductPhoto, Chip } from './ui.jsx';
import styles from './StockAlertsView.module.css';

const REFRESH_MS = 60 * 1000;

// Pestaña "Alerta stock" de Caja: discontinuo que se quedó sin disponible en
// exhibición y tiene en Rolón. El traslado se hace en Odoo; cuando exhibición
// vuelve a tener stock, el producto sale solo de la lista. "En camino" avisa
// que alguien ya lo está trayendo, para no repetirlo.
export default function StockAlertsView() {
  const [alerts, setAlerts] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setAlerts((await apiFetch('/api/feria/stock/alerts')).alerts);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function toggleTransit(alert) {
    setBusy(alert.sku);
    try {
      const { alerts: next } = await apiFetch(`/api/feria/stock/alerts/${encodeURIComponent(alert.sku)}/transit`, {
        method: 'PUT', body: JSON.stringify({ enCamino: !alert.enCamino }),
      });
      setAlerts(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const q = search.trim().toLowerCase();
  const visible = (alerts ?? []).filter(a => !q || a.sku.toLowerCase().includes(q) || (a.modelo ?? '').toLowerCase().includes(q));
  const pending = (alerts ?? []).filter(a => !a.enCamino).length;

  return (
    <div className={styles.body}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Alerta stock</h2>
          <p className={styles.muted}>
            Discontinuo sin stock en Exhibición que tiene en Rolón. Trasladalo en Odoo: cuando Exhibición vuelve a tener stock, sale solo de la lista.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Actualizar</button>
      </div>

      <Notice kind="error">{error && `No se pudo leer el stock: ${error}`}</Notice>

      {alerts && alerts.length > 0 && (
        <div className={styles.toolbar}>
          <input className="input" type="search" placeholder="Buscar por SKU o modelo" aria-label="Buscar producto"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className={styles.muted}>
            <b className="num">{alerts.length}</b> para reponer · <b className="num">{pending}</b> sin mover
          </span>
        </div>
      )}

      {alerts === null && !error && <p className={styles.muted}>Consultando stock en Odoo…</p>}
      {alerts && alerts.length === 0 && (
        <EmptyState title="Exhibición al día">No hay productos sin stock en Exhibición que tengan en Rolón.</EmptyState>
      )}
      {alerts && alerts.length > 0 && visible.length === 0 && <EmptyState title="Ningún producto coincide" />}

      <ul className={styles.list}>
        {visible.map(a => (
          <li key={a.sku} className={styles.row}>
            <ProductPhoto sku={a.sku} alt={a.modelo} size={48} />
            <div className={styles.info}>
              <p className={styles.name}>{a.modelo}</p>
              <p className={styles.muted}>{a.sku}{a.color ? ` · ${a.color.trim()}` : ''}</p>
            </div>
            <div className={styles.stock}>
              <Chip tone="removed">Exhibición {a.exhibicion}</Chip>
              <Chip tone="done">Rolón {a.rolon}</Chip>
            </div>
            <div className={styles.action}>
              {a.enCamino && <span className={styles.transit}>En camino · {a.enCamino.by} · {formatTime(a.enCamino.at)}</span>}
              <button type="button" className={`btn btn-sm ${a.enCamino ? 'btn-ghost' : 'btn-secondary'}`}
                disabled={busy === a.sku} onClick={() => toggleTransit(a)}>
                {a.enCamino ? 'Quitar' : 'Marcar en camino'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

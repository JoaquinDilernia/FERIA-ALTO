import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './CajaPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const REBAJA_LABELS = { 0: 'Normal', 1: 'Rebaja 1', 2: 'Rebaja 2' };

function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
  window.location.reload();
}

function PedidosTab() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Traemos pendientes Y errores: si un confirm falla, el backend deja el
  // pedido en 'error' y, si sólo miráramos 'pendiente', la venta desaparecería
  // de la lista y no habría forma de reintentarla desde la app.
  const loadOrders = useCallback(async () => {
    try {
      const [pendientes, errores] = await Promise.all([
        apiFetch('/api/feria/orders?status=pendiente'),
        apiFetch('/api/feria/orders?status=error'),
      ]);
      setOrders([...(errores.orders || []), ...(pendientes.orders || [])]);
    } catch {
      // Silencioso — reintenta en el próximo poll.
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  function openOrder(order) {
    setSelected(order);
  }

  async function handleConfirm() {
    if (!selected) return;
    setConfirming(true);
    try {
      // La facturación automática quedó desactivada en el backend (el pedido
      // igual se crea y se confirma en Odoo), así que vamos directo al confirm.
      await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      loadOrders();
    } catch (err) {
      // Releemos el pedido para quedarnos con el estado real ('error' + el
      // detalle que guardó el backend). Sin esto `selected` seguía mostrando
      // el snapshot viejo en 'pendiente' y el botón "Reintentar" nunca aparecía.
      try {
        const { order } = await apiFetch(`/api/feria/orders/${selected.id}`);
        setSelected(order);
      } catch {
        // Si tampoco se puede releer, al menos marcamos el error en pantalla.
        setSelected(prev => (prev ? { ...prev, status: 'error', errorDetail: err.message } : prev));
      }
      loadOrders();
      alert(`Error confirmando: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className={styles.tabBody}>
      <aside className={styles.list}>
        <h2 className={styles.listTitle}>Pedidos pendientes ({orders.length})</h2>
        {orders.map(order => (
          <button
            key={order.id}
            className={[
              styles.orderCard,
              order.status === 'error' ? styles.orderCardError : '',
              selected?.id === order.id ? styles.orderCardActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => openOrder(order)}
          >
            <strong>{order.customer.name}</strong>
            <span>{order.sellerName}</span>
            {order.status === 'error' && <span className={styles.errorTag}>Falló — reintentar</span>}
          </button>
        ))}
        {orders.length === 0 && <p className={styles.empty}>No hay pedidos pendientes.</p>}
      </aside>

      <main className={styles.detail}>
        {!selected ? (
          <p className={styles.empty}>Seleccioná un pedido de la lista.</p>
        ) : (
          <>
            <h2>{selected.customer.name}</h2>
            <p className={styles.meta}>Vendedor: {selected.sellerName} · DNI/CUIT: {selected.customer.docNumber}</p>
            <table className={styles.table}>
              <tbody>
                {selected.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.modelo} ({l.sku})</td>
                    <td>{l.condition}</td>
                    <td>x{l.qty}</td>
                    <td>${(l.qty * l.unitPrice).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.total}>
              Total: ${selected.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0).toFixed(0)}
            </p>
            <p className={styles.meta}>Método de pago cargado: {selected.paymentMethod}</p>

            {selected.status === 'error' && (
              <p className={styles.error}>Error del intento anterior: {selected.errorDetail}</p>
            )}

            <button className={styles.confirmBtn} onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirmando...' : (selected.status === 'error' ? 'Reintentar' : 'Confirmar venta')}
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function RebajasTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState('');
  const searchTimeout = useRef(null);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) return setResults([]);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  async function setRebaja(sku, condition, level) {
    setSaving(sku + condition);
    try {
      const { product } = await apiFetch(`/api/feria/products/${sku}/rebaja`, {
        method: 'PATCH', body: JSON.stringify({ condition, level }),
      });
      setResults(prev => prev.map(p => p.sku === sku ? product : p));
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving('');
    }
  }

  return (
    <div className={styles.rebajasBody}>
      <div className={styles.field}>
        <label className={styles.label}>Buscar SKU o modelo (mínimo 6 caracteres)</label>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Ej: BCT037MA"
        />
      </div>
      {results.map(p => (
        <div key={p.sku} className={styles.rebajaCard}>
          <strong>{p.modelo} ({p.sku})</strong>
          {['falla', 'discontinuo'].map(condition => (
            p.condiciones[condition].disponible && (
              <div key={condition} className={styles.rebajaRow}>
                <span className={styles.rebajaLabel}>{condition} — ${p.condiciones[condition].precioTabla}</span>
                <div className={styles.rebajaButtons}>
                  {[0, 1, 2].map(level => (
                    <button
                      key={level}
                      type="button"
                      disabled={saving === p.sku + condition}
                      className={`${styles.rebajaBtn} ${p.condiciones[condition].rebajaActiva === level ? styles.rebajaBtnActive : ''}`}
                      onClick={() => setRebaja(p.sku, condition, level)}
                    >
                      {REBAJA_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CajaPanel() {
  const [tab, setTab] = useState('pedidos');

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        <button className={`${styles.tabBtn} ${tab === 'pedidos' ? styles.tabBtnActive : ''}`} onClick={() => setTab('pedidos')}>
          Pedidos
        </button>
        <button className={`${styles.tabBtn} ${tab === 'rebajas' ? styles.tabBtnActive : ''}`} onClick={() => setTab('rebajas')}>
          Rebajas por SKU
        </button>
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </nav>
      {tab === 'pedidos' ? <PedidosTab /> : <RebajasTab />}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import OrderLines from '../components/OrderLines.jsx';
import EntregasView from '../components/EntregasView.jsx';
import { orderTotal, SHIPPING_COST } from '../lib/feriaLabels.js';
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
  const [stockBySku, setStockBySku] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

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

  // Stock en vivo de cada SKU del pedido (disponible = Odoo − reservado, así
  // que ya descuenta lo que reserva este mismo pedido).
  async function loadStock(order) {
    const skus = [...new Set(order.lines.map(l => l.sku))];
    const entries = await Promise.all(skus.map(async (sku) => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(sku)}`);
        return [sku, products.find(p => p.sku === sku)?.stock ?? null];
      } catch {
        return [sku, null];
      }
    }));
    setStockBySku(Object.fromEntries(entries));
  }

  function openOrder(order) {
    setSelected(order);
    setMessage('');
    setStockBySku({});
    loadStock(order);
  }

  async function runAction(key, request, successMessage = '') {
    setBusy(key);
    setMessage('');
    try {
      const { order } = await request();
      setSelected(order);
      loadStock(order);
      if (successMessage) setMessage(successMessage);
      loadOrders();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy('');
    }
  }

  function removeLine(line) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, { method: 'DELETE' }));
  }

  function editLine(line, changes) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    }));
  }

  function handleCancel() {
    if (!window.confirm('¿Cancelar el pedido? Se libera todo el stock reservado.')) return;
    runAction('cancel', () => apiFetch(`/api/feria/orders/${selected.id}/cancel`, { method: 'POST' }), 'Pedido cancelado.');
  }

  async function handleConfirm() {
    if (!selected) return;
    setBusy('confirm');
    setMessage('');
    try {
      // La facturación automática quedó desactivada en el backend (el pedido
      // igual se crea y se confirma en Odoo), así que vamos directo al confirm.
      const { order } = await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      setMessage(order.errorDetail ? `Confirmado con aviso: ${order.errorDetail}` : 'Pedido confirmado en Odoo.');
      loadOrders();
    } catch (err) {
      // Releemos el pedido para quedarnos con el estado real ('error' + el
      // detalle que guardó el backend) y que aparezca "Reintentar".
      try {
        const { order } = await apiFetch(`/api/feria/orders/${selected.id}`);
        setSelected(order);
      } catch {
        setSelected(prev => (prev ? { ...prev, status: 'error', errorDetail: err.message } : prev));
      }
      setMessage(`Error confirmando: ${err.message}`);
      loadOrders();
    } finally {
      setBusy('');
    }
  }

  const editable = selected && ['pendiente', 'error'].includes(selected.status);

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
        {message && <p className={styles.message}>{message}</p>}
        {!selected ? (
          <p className={styles.empty}>Seleccioná un pedido de la lista.</p>
        ) : (
          <>
            <h2>{selected.customer.name}</h2>
            <p className={styles.meta}>Vendedor: {selected.sellerName} · DNI/CUIT: {selected.customer.docNumber}</p>
            {selected.status === 'cancelado' && <p className={styles.error}>Pedido cancelado.</p>}

            <OrderLines
              lines={selected.lines}
              stockBySku={stockBySku}
              busyLineId={busy}
              onEdit={editable ? editLine : undefined}
              onRemove={editable ? removeLine : undefined}
            />

            {selected.shipping && (
              <p className={styles.meta}>
                Envío (${SHIPPING_COST}): {selected.shipping.street} {selected.shipping.number} {selected.shipping.floor}
                {' '}— {selected.shipping.city} ({selected.shipping.zip}) · Tel {selected.shipping.phone}
                {selected.shipping.notes ? ` · ${selected.shipping.notes}` : ''}
              </p>
            )}
            <p className={styles.total}>Total: ${orderTotal(selected).toFixed(0)}</p>
            <p className={styles.meta}>Método de pago cargado: {selected.paymentMethod}</p>

            {selected.status === 'error' && (
              <p className={styles.error}>Error del intento anterior: {selected.errorDetail}</p>
            )}

            {editable && (
              <div className={styles.actionsRow}>
                <button className={styles.confirmBtn} onClick={handleConfirm} disabled={!!busy}>
                  {busy === 'confirm' ? 'Confirmando...' : (selected.status === 'error' ? 'Reintentar' : 'Confirmar venta')}
                </button>
                <button className={styles.cancelBtn} onClick={handleCancel} disabled={!!busy}>Cancelar pedido</button>
              </div>
            )}
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

const TABS = [
  { value: 'pedidos', label: 'Pedidos' },
  { value: 'entregas', label: 'Entregas' },
  { value: 'rebajas', label: 'Rebajas por SKU' },
];

export default function CajaPanel() {
  const [tab, setTab] = useState('pedidos');

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.value} className={`${styles.tabBtn} ${tab === t.value ? styles.tabBtnActive : ''}`} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </nav>
      {tab === 'pedidos' && <PedidosTab />}
      {/* Caja arranca en "Retiros en feria" (lo que el cliente viene a buscar),
          pero puede ver y marcar todo, igual que Logística. */}
      {tab === 'entregas' && <EntregasView initialFilter="retiros_feria" />}
      {tab === 'rebajas' && <RebajasTab />}
    </div>
  );
}
